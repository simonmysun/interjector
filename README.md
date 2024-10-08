# Interjector

Interjector is a web application designed to enhance your communication experience. This tool offers a unique blend of features that can translate, summarize, and process your speech to provide a more comprehensive and engaging interaction. 

## Features

1. **Transcription**: Interjector generates a transcript of your speech from your microphone. 

2. **Translation & Summarization**: This feature can be particularly helpful when dealing with foreign languages or lengthy dialogues. 

3. **Completion with GPT**: Interjector can process the transcript using GPT models. This allows for potential insights, suggestions, or even jokes to be generated based on the context of the conversation.

## Potential Use Cases

1. **Language Learning**: Interjector can help you pick up new words and phrases in a foreign language. It can also assist in understanding and constructing sentences in a new language.

2. **Dialog Enhancement**: While listening to a dialog, such as during an interview or discussion, Interjector provides additional information to enrich your understanding of the topic.

3. **Humour Generation**: Interjector can generate related jokes based on the context of your conversation, helping you talk with humour and making your interactions more enjoyable.

## Getting Started

To get started with Interjector, you will need to host the application which requires both a frontend and backend setup. Basically:

1. Clone this repository.
1. Install the dependencies via `npm install`.
1. Run `npm run build`.
1. Enter the `./dist` directory and run `node server.bundle.js`.

You will need to configure it according to the next chapter.

Notes:

- You can specify the host and port by setting the `HOST` and `PORT` environment variables when running the server. The default port is 8000.
- Currently, the recognition is only using the Web Speech API which is supported by almost only Chrome and the performance of languages other than English is not promising. In the future, we will present a Whisper backend to support more browsers and languages.
- Chrome requires a secure context to use the Web Speech API. I have packed a self-signed certificate but using it in a public production environment is highly unrecommended. You can specify `KEY_PATH`, `CERT_PATH` in the environment variables to use your own certificate or let your reverse proxy handle the SSL. To disable HTTPS, set `HTTP_ONLY` to `true`.
- If the self-signed certificate is used, you have to allow Chrome to load insecure content by e.g. typing `badidea`. 

## Configuration

When the server is running, go to `./settings.html` to fill in the configuration such as the API for translation and GPT, and the prompts.

- Use BCP 47 language tag for the source language and target language. The source language is also used for speech recognition.
- Translation backend includes 'free-google-translate', ~~'google-translate'~~ (not implemented yet), ~~'bing-translate'~~ (not implemented yet), ~~'deepl-translate'~~ (not implemented yet), 'openai-translate'. When using 'openai-translate', you need to provide the model and prompt.
- For completion, you need to fill in an API key and URL. You also need to provide a prompt for the completion. If the model selected starts with 'gemini', the API URL is assumed to be Google Gemini style, otherwise, it is assumed to be OpenAI style.
  - For example, you may set model to `gemini-1.5-flash-latest` and use `https://generativelanguage.googleapis.com/v1beta/models/` for API URL.
- [Prompt Examples](./docs/prompt-examples.md) are provided to help you get started.

## Screenshot

Screenshot demonstrating interjector generating response while listening to an interview:

![Screenshot demonstrating interjector generating response while listening to an interview](https://raw.githubusercontent.com/simonmysun/interjector/master/docs/screenshots/1.png)


## TODO

1. The current implementation of speech recognition is based on Web Speech API. As of 2024-05-20 This API is not supported by most browsers and Chrome can almost only recognize English. We need to implement a more robust solution that works across more browsers and supports more languages.
1. More translation API
1. More prompts

## License
See [LICENSE](LICENSE).

