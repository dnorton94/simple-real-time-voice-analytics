import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from "@google/genai";

// --- Audio Helper Functions ---

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// --- Main Application Component ---

const App = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [practiceCount, setPracticeCount] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Refs for managing the session and audio state
  const sessionRef = useRef<Promise<any> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // Refs for counting logic to avoid closure staleness
  const committedCountRef = useRef(0);
  const currentTurnTextRef = useRef("");
  
  // Helper to count occurrences of "practice" in a string
  const countPracticeInText = (text: string) => {
    const matches = text.match(/\bpractice\b/gi);
    return matches ? matches.length : 0;
  };

  const startSession = async () => {
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // Initialize Audio Contexts
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      inputAudioContextRef.current = inputCtx;
      audioContextRef.current = outputCtx;

      // Get Microphone Stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Connect to Gemini Live
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {}, // Enable transcription to detect "practice"
          systemInstruction: "You are a silent observer listening to the user. You do not need to speak. Your goal is to let the system track the word 'practice'.",
        },
        callbacks: {
          onopen: () => {
            console.log("Session connected");
            setIsRecording(true);
            
            // Setup Input Processing
            const source = inputCtx.createMediaStreamSource(stream);
            sourceRef.current = source;
            
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const blob = createBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: blob });
              });
            };

            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Transcription for Counting
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              
              // Append to current turn buffer
              currentTurnTextRef.current += text;
              
              // Calculate count for this specific turn
              const turnCount = countPracticeInText(currentTurnTextRef.current);
              
              // Update total count state
              setPracticeCount(committedCountRef.current + turnCount);
              
              // Update transcript UI (showing last ~100 chars for context)
              setTranscript(prev => {
                const full = prev + text;
                return full.slice(-300); 
              });
            }
            
            if (message.serverContent?.turnComplete) {
              // Commit the count from this turn so we don't recount it
              const turnCount = countPracticeInText(currentTurnTextRef.current);
              committedCountRef.current += turnCount;
              currentTurnTextRef.current = "";
            }

            // Handle Audio Output (Standard requirement, even if silent)
            const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && outputCtx) {
              const audioBuffer = await decodeAudioData(
                decode(audioData),
                outputCtx,
                24000,
                1
              );
              const source = outputCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputCtx.destination);
              source.start();
            }
          },
          onclose: () => {
            console.log("Session closed");
            setIsRecording(false);
          },
          onerror: (err) => {
            console.error("Session error", err);
            setError("Connection error detected.");
            setIsRecording(false);
          }
        }
      });

      sessionRef.current = sessionPromise;

    } catch (e: any) {
      console.error(e);
      setError(e.message || "Failed to start session");
      setIsRecording(false);
    }
  };

  const stopSession = async () => {
    // Stop Audio Tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Disconnect Audio Nodes
    if (sourceRef.current && processorRef.current) {
      sourceRef.current.disconnect();
      processorRef.current.disconnect();
    }

    // Close Audio Contexts
    if (inputAudioContextRef.current) await inputAudioContextRef.current.close();
    if (audioContextRef.current) await audioContextRef.current.close();

    // Reset Refs
    inputAudioContextRef.current = null;
    audioContextRef.current = null;
    sourceRef.current = null;
    processorRef.current = null;

    // Reset Turn Logic
    committedCountRef.current += countPracticeInText(currentTurnTextRef.current);
    currentTurnTextRef.current = "";

    setIsRecording(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSession();
    };
  }, []);

  return (
    <div style={{
      fontFamily: "'Inter', sans-serif",
      backgroundColor: "#121212",
      color: "#ffffff",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px"
    }}>
      <style>{`
        body { margin: 0; padding: 0; background: #121212; }
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(100, 108, 255, 0.4); }
          70% { box-shadow: 0 0 0 20px rgba(100, 108, 255, 0); }
          100% { box-shadow: 0 0 0 0 rgba(100, 108, 255, 0); }
        }
      `}</style>

      <div style={{
        maxWidth: "600px",
        width: "100%",
        textAlign: "center"
      }}>
        <h1 style={{ marginBottom: "10px", fontWeight: 300, letterSpacing: "1px", color: "#e0e0e0" }}>Practice Tracker</h1>
        
        <div style={{
          backgroundColor: "#1e1e1e",
          borderRadius: "24px",
          padding: "40px",
          margin: "30px 0",
          border: "1px solid #333",
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)"
        }}>
          <div style={{ fontSize: "16px", color: "#888", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "2px" }}>
            "Practice" Count
          </div>
          <div style={{ 
            fontSize: "120px", 
            fontWeight: "bold", 
            lineHeight: 1, 
            color: isRecording ? "#646cff" : "#555",
            transition: "color 0.3s ease"
          }}>
            {practiceCount}
          </div>
        </div>

        <div style={{ minHeight: "60px", marginBottom: "30px" }}>
          {isRecording ? (
             <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
                <div style={{
                  width: "12px", height: "12px", backgroundColor: "#00ff88", borderRadius: "50%",
                  animation: "pulse 2s infinite"
                }}></div>
                <span style={{ color: "#00ff88" }}>Listening for "practice"...</span>
             </div>
          ) : (
            <span style={{ color: "#666" }}>Ready to start</span>
          )}
          {error && <div style={{ color: "#ff4444", marginTop: "10px" }}>{error}</div>}
        </div>

        <button
          onClick={isRecording ? stopSession : startSession}
          style={{
            backgroundColor: isRecording ? "#ff4444" : "#646cff",
            color: "white",
            border: "none",
            padding: "16px 32px",
            fontSize: "18px",
            borderRadius: "50px",
            cursor: "pointer",
            fontWeight: 600,
            transition: "all 0.2s",
            boxShadow: isRecording ? "0 4px 15px rgba(255, 68, 68, 0.4)" : "0 4px 15px rgba(100, 108, 255, 0.4)"
          }}
          onMouseOver={(e) => e.currentTarget.style.transform = "scale(1.05)"}
          onMouseOut={(e) => e.currentTarget.style.transform = "scale(1)"}
        >
          {isRecording ? "Stop Tracking" : "Start Tracking"}
        </button>

        {transcript && (
          <div style={{ 
            marginTop: "40px", 
            textAlign: "left", 
            opacity: 0.7, 
            background: "#1a1a1a", 
            padding: "15px", 
            borderRadius: "12px",
            fontSize: "14px",
            lineHeight: "1.6",
            border: "1px solid #333"
          }}>
            <strong style={{ display: "block", marginBottom: "5px", color: "#888" }}>Transcript:</strong>
            <span style={{ color: "#ccc" }}>...{transcript}</span>
          </div>
        )}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);