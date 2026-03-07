# Static Resources

This folder contains static binaries and AI models required for the application
to run.

## FFmpeg Binaries

Please download the static binaries for FFmpeg and place the executable in the
corresponding folder.

- **macOS**: [Download from evermeet.cx](https://evermeet.cx/ffmpeg/) -> put
  `ffmpeg` and `ffprobe` in `ffmpeg-mac/`
- **Windows**: [Download from gyan.dev](https://www.gyan.dev/ffmpeg/builds/) ->
  put `ffmpeg.exe` and `ffprobe.exe` in `ffmpeg-win/`
- **Linux**:
  [Download from johnvansickle.com](https://johnvansickle.com/ffmpeg/) -> put
  `ffmpeg` and `ffprobe` in `ffmpeg-linux/`

Ensure the binaries are executable (`chmod +x ffmpeg` on Mac/Linux).

## Vosk AI Models

The application uses Vosk for audio transcription. You need to download a model
and place it in the `vosk-model/` directory.

1. **Download the model** from the
   [Vosk Models page](https://alphacephei.com/vosk/models).
2. **Extract the model** into `resources/vosk-model/`.
3. The application uses: `vosk-model-en-us-0.22-lgraph` (Large model for better
   accuracy)

Example structure:

```text
resources/vosk-model/vosk-model-en-us-0.22-lgraph/
├── am/
├── conf/
├── graph/
├── ivector/
└── README
```
