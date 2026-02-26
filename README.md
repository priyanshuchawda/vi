# QuickCut Video Editor ⚡

<div align="center">

[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](https://github.com/AntiDynamic/quickcut-video-editor)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-40.0-47848F.svg)](https://www.electronjs.org/)

**QuickCut** is a fast, AI-powered desktop video editor built for quick edits and professional exports. Perfect for YouTubers, content creators, and anyone who needs powerful video editing without the complexity of traditional NLEs.

[Features](#-features) • [Installation](#-installation) • [Usage](#-usage) • [Development](#-development) • [Contributing](#-contributing)

</div>

---

## ✨ Features

### 🎬 Core Video Editing
- **⚡ Blazing Fast Performance**: Optimized workflows with smart caching and stream copying
- **✂️ Precision Editing**: Frame-perfect splitting, trimming, and merging
- **🎵 Multi-Track Timeline**: Separate video and audio tracks for professional editing
- **🎞️ Visual Timeline**: Drag-and-drop interface with thumbnail and waveform visualization
- **📦 Multi-Format Support**: MP4, MOV, MKV, AVI, WebM + images (PNG, JPG) and audio files (MP3, WAV, AAC)
- **🎯 Smart Export**: Auto-detects when re-encoding isn't needed (up to 50x faster!)

### 🤖 AI-Powered Features
- **🎙️ Audio Transcription**: Automatic speech-to-text using Vosk AI models
- **📝 Timestamped Segments**: Get accurate timestamps for every spoken word
- **💬 Subtitle Generation**: Export transcriptions as SRT subtitle files
- **📄 Text Export**: Save transcriptions as plain text documents
- **🔍 Interactive Navigation**: Click segments to jump to specific timeline positions

### 📝 Text & Subtitles
- **✍️ Text Overlays**: Add custom text with full typography controls
- **🎨 Rich Styling**: Font family, size, color, bold, italic, outline support
- **📍 Flexible Positioning**: Top, center, bottom, or custom positioning
- **🎯 Text Alignment**: Left, center, right alignment options
- **🎬 Subtitle Management**: Import and style SRT subtitle files
- **🔥 Subtitle Export**: Burn subtitles directly into video or export as files

### 💾 Project Management
- **💾 Auto-Save**: Automatic project saving at configurable intervals (30s - 10min)
- **🔄 Project Files**: Save and load complete editing sessions
- **⌨️ Keyboard Shortcuts**: Fast workflow with Ctrl+S, Ctrl+O, and more
- **🔔 Notifications**: Real-time feedback for all operations
- **⚠️ Unsaved Changes Warning**: Never lose work with before-close prompts

### ⚙️ Advanced Features
- **🎨 Export Options**: Multiple resolutions (480p, 720p, 1080p, original)
- **📊 Waveform Visualization**: Visual audio editing with waveform display
- **🖼️ Thumbnail Generation**: Smart caching for instant timeline preview
- **🎭 Context Menus**: Right-click functionality throughout the interface
- **🔒 100% Private**: No cloud, no accounts, no tracking - everything stays local

## 🎯 Perfect For

- 📹 **YouTube Creators**: Quick cuts, transcriptions, and subtitle generation
- 🎙️ **Podcast Editors**: Audio transcription and precise audio editing
- 📱 **Social Media**: Fast exports optimized for Instagram, TikTok, Twitter
- 🎓 **Educational Content**: Add text overlays and subtitles for accessibility
- 📺 **Screen Recordings**: Trim and annotate tutorial videos
- 🎵 **Music Videos**: Create image slideshows with audio tracks
- 🎬 **Content Creators**: Professional editing without the learning curve

## 🚀 Installation

### Prerequisites

- **Node.js** v18 or higher ([Download](https://nodejs.org/))
- **npm** or **yarn** package manager
- **FFmpeg** (bundled with the application)

### Quick Setup

```bash
# Clone the repository
git clone https://github.com/AntiDynamic/quickcut-video-editor.git
cd quickcut-video-editor

# Install dependencies
npm install

# Start development server
npm run dev
```

### Build for Production

```bash
# Build for current platform
npm run dist

# Build for specific platforms
npm run dist:mac    # macOS (Intel + Apple Silicon)
npm run dist:win    # Windows x64
npm run dist:linux  # Linux x64

# Build for all platforms
npm run dist:all
```

## 💻 Usage

### Basic Workflow

1. **Import Media**: Click "Import" or drag files into the File Panel
2. **Add to Timeline**: Drag clips from File Panel to Timeline
3. **Edit**: Split, trim, and arrange clips on the timeline
4. **Transcribe** (Optional): Click "Transcribe Clip" for AI-powered speech-to-text
5. **Add Text/Subtitles** (Optional): Use text editor or import SRT files
6. **Export**: Click "Export" and choose your settings

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + S` | Save Project |
| `Ctrl/Cmd + O` | Open Project |
| `Ctrl/Cmd + E` | Export Video |
| `Space` | Play/Pause |
| `Delete/Backspace` | Delete Selected Clip |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Y` | Redo |

### Transcription Workflow

1. **Setup Model**: Download and place a Vosk model in `resources/vosk-model/` (see [AI Model Setup](#-ai-model-setup))
2. **Import Video**: Add a video file with spoken audio
3. **Transcribe**: Click "Transcribe Clip" button in toolbar
4. **Wait**: Transcription processing (speed depends on model size)
5. **Review**: View segments in TranscriptionPanel
6. **Export**: 
   - **TXT**: Full text document
   - **SRT**: Subtitle file with timestamps
   - **Copy**: Copy to clipboard

### Text Overlay Workflow

1. **Open Text Editor**: Click text overlay button in toolbar
2. **Enter Text**: Type your text content
3. **Style**: Choose font, size, color, position
4. **Advanced**: Add outline, background, bold/italic
5. **Duration**: Set how long text displays
6. **Add**: Text appears as clip on timeline

## 🏗️ Development

### Project Structure

```
quickcut-video-editor/
├── electron/              # Electron main process
│   ├── main.ts           # Main entry point
│   ├── preload.ts        # Preload script
│   ├── ffmpeg/           # FFmpeg processing
│   └── utils/            # Utilities (transcription, cache)
├── src/                  # React renderer process
│   ├── components/       # UI components
│   │   ├── FilePanel/
│   │   ├── Timeline/
│   │   ├── Preview/
│   │   ├── Toolbar/
│   │   └── ui/          # Modals and overlays
│   ├── stores/          # Zustand state management
│   ├── lib/             # Utilities and helpers
│   └── types/           # TypeScript definitions
├── test/                # Test suite
│   ├── stores/          # Store unit tests
│   ├── lib/             # Library tests
│   ├── components/      # Component tests
│   └── integration/     # Integration tests
└── resources/           # Static resources (FFmpeg binaries)
```

### Tech Stack

| Technology | Purpose |
|------------|---------|
| **Electron 40.0** | Cross-platform desktop framework |
| **React 19.2** | UI rendering and component system |
| **TypeScript 5.9** | Type safety and developer experience |
| **FFmpeg** | Media processing and video encoding |
| **Zustand 5.0** | Lightweight state management |
| **Tailwind CSS 4.1** | Utility-first styling |
| **Vitest 4.0** | Unit and integration testing |
| **vosk-koffi** | Vosk AI for local transcription |

## 🤖 AI Model Setup

QuickCut uses **Vosk** for local, private transcription. You must provide a model for this feature to work:

1. Visit the [Vosk Models page](https://alphacephei.com/vosk/models).
2. Download the `vosk-model-en-us-0.22-lgraph` model for accurate transcription.
3. Extract the model into the `resources/vosk-model/` directory.
4. Ensure the folder name is `vosk-model-en-us-0.22-lgraph`

For more details on setting up FFmpeg and Models, see [resources/README.md](resources/README.md).

### Quick Download (Linux/macOS)

```bash
wget https://alphacephei.com/vosk/models/vosk-model-en-us-0.22-lgraph.zip
unzip vosk-model-en-us-0.22-lgraph.zip -d resources/vosk-model/
rm vosk-model-en-us-0.22-lgraph.zip
```

### Running Tests

```bash
# Run all tests
npm test

# Watch mode for development
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### Code Quality

```bash
# Lint code
npm run lint

# Type checking
npx tsc --noEmit
```

## 🎯 Performance Optimizations

QuickCut includes several optimizations that make it 5-50x faster than traditional editors:

1. **Smart Stream Copying**: Full clips export without re-encoding (18x faster)
2. **No Image Pre-conversion**: Images stored directly, converted only on export
3. **Persistent Caching**: Thumbnails and waveforms cached for instant reload
4. **Resolution Control**: Export at lower resolutions for faster processing
5. **Audio Extraction**: Separate audio processing for transcription
6. **Lazy Loading**: Components and models loaded only when needed

## 🧪 Testing

QuickCut has comprehensive test coverage:

- **27 Store Tests**: State management and data flow
- **16 Integration Tests**: End-to-end workflows
- **Component Tests**: UI interactions and rendering
- **Library Tests**: Utility functions and helpers

All tests pass with 100% success rate.

## 🤝 Contributing

We welcome contributions! Here's how to get started:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feat/amazing-feature`)
3. **Commit** your changes (`git commit -m 'feat: Add amazing feature'`)
4. **Push** to your branch (`git push origin feat/amazing-feature`)
5. **Open** a Pull Request

### Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `test:` Test additions or modifications
- `refactor:` Code refactoring
- `perf:` Performance improvements
- `chore:` Build process or tooling changes

## 📝 License

MIT © [QuickCut Team](https://github.com/AntiDynamic/quickcut-video-editor)

---

## 🌟 Acknowledgments

- **FFmpeg** - The backbone of media processing
- **Vosk AI** - Local, privacy-focused speech recognition
- **Electron** - Cross-platform desktop framework
- **React** - UI framework
- All our contributors and users!

## 📧 Support & Contact

- **Issues**: [GitHub Issues](https://github.com/AntiDynamic/quickcut-video-editor/issues)
- **Discussions**: [GitHub Discussions](https://github.com/AntiDynamic/quickcut-video-editor/discussions)
- **Pull Requests**: [Contributing Guide](#-contributing)

---

<div align="center">

**Made with ❤️ by the QuickCut Team**

⭐ Star us on GitHub if you find QuickCut useful!

</div>
