# Real-time Speech Analytics with Gemini Live API

This project demonstrates a real-time speech analytics application using the Google Gemini Live API. It connects to a live audio stream from the user's microphone, transcribes speech in real-time, and performs instant keyword analysis.

In this specific demo, the application tracks and counts occurrences of the word **"practice"**.

## Use Cases

This architecture serves as a foundational template for various real-time analytics scenarios:

### 1. Political Analysis & Media Monitoring
*   **Debate Tracking:** Instantly count how many times a candidate mentions specific policy keywords (e.g., "economy," "healthcare," "freedom") during a live debate.
*   **Sentiment Analysis:** Analyze tone and sentiment shifts in real-time during speeches or interviews.
*   **Fact-Checking Triggers:** Flag specific claims for human review as soon as they are spoken.

### 2. Education & Public Speaking
*   **Filler Word Counter:** Help students or professionals improve public speaking by tracking filler words like "um," "uh," or "like."
*   **Vocabulary Usage:** Monitor the diversity of vocabulary used during a presentation.

### 3. Customer Support & Sales
*   **Compliance Monitoring:** Ensure agents say required disclosure statements during calls.
*   **Objection Handling:** Detect when a customer says "too expensive" or "not interested" to prompt the agent with real-time counter-arguments.

## Technology Stack

*   **Frontend:** React (TypeScript)
*   **AI Model:** Google Gemini Multimodal Live API (`gemini-2.5-flash-native-audio-preview`)
*   **Audio Processing:** Web Audio API (PCM 16kHz streaming)

## Setup

1.  Get a Gemini API Key from [Google AI Studio](https://aistudio.google.com/).
2.  Add your API key to the `.env` file.
3.  Run the application.
