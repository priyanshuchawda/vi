import { app, BrowserWindow, ipcMain, dialog, nativeImage } from "electron";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import ffmpeg, {
  exportVideo,
  generateThumbnail,
  generateWaveform,
} from "./ffmpeg/processor.js";
import { transcribeVideo, transcribeTimeline } from "./utils/transcription.js";
import { ChannelAnalysisService } from "./services/channelAnalysisService.js";
import { 
  authenticateUser, 
  isAuthenticated, 
  logout as youtubeLogout 
} from "./services/youtubeAuthService.js";
import { uploadVideo } from "./services/youtubeUploadService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
config({ path: path.join(__dirname, "../.env") });

// API Keys from environment variables
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || "";
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || "";
const BEDROCK_MODEL_ID =
  process.env.BEDROCK_MODEL_ID || "amazon.nova-lite-v1:0";

console.log("[Main] API Keys loaded:");
console.log(`  - YouTube API Key: ${YOUTUBE_API_KEY ? "Set" : "Missing"}`);
console.log(`  - AWS Region: ${AWS_REGION}`);
console.log(`  - AWS Access Key: ${AWS_ACCESS_KEY_ID ? "Set" : "Missing"}`);
console.log(
  `  - AWS Secret Key: ${AWS_SECRET_ACCESS_KEY ? "Set" : "Missing"}`,
);

// Initialize analysis service
let analysisService: ChannelAnalysisService | null = null;
let bedrockGatewayClient: BedrockRuntimeClient | null = null;
if (YOUTUBE_API_KEY && AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) {
  analysisService = new ChannelAnalysisService(
    YOUTUBE_API_KEY,
    AWS_REGION,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    BEDROCK_MODEL_ID,
  );
  console.log("[Main] Channel analysis service initialized (Bedrock)");
  bedrockGatewayClient = new BedrockRuntimeClient({
    region: AWS_REGION,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
      ...(process.env.AWS_SESSION_TOKEN
        ? { sessionToken: process.env.AWS_SESSION_TOKEN }
        : {}),
    },
  });
} else {
  console.warn("[Main] Missing API keys - channel analysis disabled");
}

// Set the application name for the menu bar
app.setName("QuickCut");

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "QuickCut",
    icon: path.join(
      __dirname,
      app.isPackaged ? "../dist/logo.png" : "../public/logo.png",
    ),
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // allow loading local files
      sandbox: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:7377";

  if (!app.isPackaged) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Set dock icon on macOS
  if (process.platform === "darwin" && app.dock) {
    const iconPath = path.join(
      __dirname,
      app.isPackaged ? "../dist/logo.png" : "../public/logo.png",
    );
    app.dock.setIcon(iconPath);
  }

  mainWindow.webContents.openDevTools();
}

ipcMain.handle("dialog:openFile", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "All Media",
        extensions: [
          "mp4",
          "mov",
          "avi",
          "mkv",
          "webm",
          "mp3",
          "wav",
          "aac",
          "flac",
          "ogg",
          "m4a",
          "jpg",
          "jpeg",
          "png",
          "gif",
          "webp",
          "bmp",
          "srt",
        ],
      },
      { name: "Videos", extensions: ["mp4", "mov", "avi", "mkv", "webm"] },
      {
        name: "Audio",
        extensions: ["mp3", "wav", "aac", "flac", "ogg", "m4a"],
      },
      {
        name: "Images",
        extensions: ["jpg", "jpeg", "png", "gif", "webp", "bmp"],
      },
      { name: "Subtitles", extensions: ["srt"] },
    ],
  });
  if (canceled) {
    return [];
  } else {
    return filePaths;
  }
});

ipcMain.handle("media:getMetadata", async (_, filePath) => {
  // Check if the file is an image
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
  const ext = path.extname(filePath).toLowerCase();
  const isImage = imageExtensions.includes(ext);

  if (isImage) {
    // For images, return default duration and get dimensions if possible
    try {
      const img = nativeImage.createFromPath(filePath);
      const size = img.getSize();
      return {
        duration: 5, // Default 5 seconds for images
        format: "image",
        width: size.width,
        height: size.height,
        isImage: true,
      };
    } catch (error) {
      console.error("Failed to read image:", error);
      return {
        duration: 5,
        format: "image",
        width: 1920,
        height: 1080,
        isImage: true,
      };
    }
  }

  // For video and audio files, use ffprobe
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err: any, metadata: any) => {
      if (err) {
        console.error("ffprobe error:", err);
        reject(err);
      } else {
        console.log("ffprobe success:", metadata.format.duration);
        const videoStream = metadata.streams.find(
          (s: any) => s.codec_type === "video",
        );
        const audioStream = metadata.streams.find(
          (s: any) => s.codec_type === "audio",
        );

        resolve({
          duration: metadata.format.duration,
          format: metadata.format.format_name,
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
          hasVideo: !!videoStream,
          hasAudio: !!audioStream,
        });
      }
    });
  });
});

ipcMain.handle("media:getThumbnail", async (_, filePath) => {
  try {
    const base64 = await generateThumbnail(filePath);
    return base64;
  } catch (error) {
    console.error("Failed to generate thumbnail:", error);
    return null;
  }
});

ipcMain.handle("media:getWaveform", async (_, filePath) => {
  try {
    const base64 = await generateWaveform(filePath);
    return base64;
  } catch (error) {
    console.error("Failed to generate waveform:", error);
    return null;
  }
});

ipcMain.handle("dialog:saveFile", async (_, format = "mp4") => {
  const extensions: { [key: string]: string } = {
    mp4: "MP4",
    mov: "MOV",
    avi: "AVI",
    webm: "WebM",
  };

  const { canceled, filePath } = await dialog.showSaveDialog({
    filters: [{ name: extensions[format] || "Video", extensions: [format] }],
    defaultPath: `output.${format}`,
  });
  if (canceled) {
    return null;
  } else {
    return filePath;
  }
});

ipcMain.handle("project:saveProject", async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Save Project",
    defaultPath: "project.quickcut",
    filters: [{ name: "QuickCut Project", extensions: ["quickcut"] }],
  });
  if (canceled) {
    return null;
  } else {
    return filePath;
  }
});

ipcMain.handle("project:writeProjectFile", async (_, { filePath, data }) => {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    return { success: true };
  } catch (error) {
    console.error("Failed to write project file:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle("project:loadProject", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Load Project",
    properties: ["openFile"],
    filters: [{ name: "QuickCut Project", extensions: ["quickcut"] }],
  });
  if (canceled || filePaths.length === 0) {
    return null;
  } else {
    return filePaths[0];
  }
});

ipcMain.handle("project:readProjectFile", async (_, filePath) => {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return { success: true, data: JSON.parse(data) };
  } catch (error) {
    console.error("Failed to read project file:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle("file:readTextFile", async (_, filePath) => {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return { success: true, data };
  } catch (error) {
    console.error("Failed to read text file:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(
  "media:exportVideo",
  async (
    event,
    { clips, outputPath, format = "mp4", resolution, subtitles, subtitleStyle },
  ) => {
    try {
      await exportVideo(
        clips,
        event.sender,
        outputPath,
        format,
        resolution,
        subtitles,
        subtitleStyle,
      );
      return true;
    } catch (error) {
      console.error("Export failed:", error);
      throw error;
    }
  },
);

// Transcription handlers
ipcMain.handle(
  "transcription:transcribeVideo",
  async (event, videoPath: string) => {
    try {
      const result = await transcribeVideo(videoPath, (progress) => {
        event.sender.send("transcription:progress", progress);
      });
      return { success: true, result };
    } catch (error) {
      console.error("Transcription failed:", error);
      return { success: false, error: String(error) };
    }
  },
);

ipcMain.handle(
  "transcription:transcribeTimeline",
  async (
    event,
    clips: Array<{ path: string; startTime: number; duration: number }>,
  ) => {
    try {
      const result = await transcribeTimeline(clips, (progress) => {
        event.sender.send("transcription:progress", progress);
      });
      return { success: true, result };
    } catch (error) {
      console.error("Timeline transcription failed:", error);
      return { success: false, error: String(error) };
    }
  },
);

// Channel Analysis handlers
ipcMain.handle("analysis:analyzeChannel", async (event, channelUrl: string) => {
  if (!analysisService) {
    return {
      success: false,
      error: "Analysis service not initialized - missing API keys",
      error_code: "SERVICE_NOT_AVAILABLE",
    };
  }

  try {
    console.log(`[IPC] Analyzing channel: ${channelUrl}`);
    const result = await analysisService.analyzeChannel(channelUrl);
    return result;
  } catch (error) {
    console.error("[IPC] Channel analysis error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      error_code: "ANALYSIS_ERROR",
    };
  }
});

ipcMain.handle("analysis:getUserAnalysis", async (event, userId: string) => {
  if (!analysisService) {
    return { success: false, error: "Analysis service not initialized" };
  }

  try {
    const analysis = analysisService.getUserAnalysis(userId);
    if (analysis) {
      return { success: true, data: analysis };
    } else {
      return { success: false, error: "No analysis found for user" };
    }
  } catch (error) {
    console.error("[IPC] Get user analysis error:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(
  "analysis:linkToUser",
  async (event, userId: string, channelUrl: string) => {
    if (!analysisService) {
      return { success: false };
    }

    try {
      const linked = await analysisService.linkAnalysisToUser(
        userId,
        channelUrl,
      );
      return { success: linked };
    } catch (error) {
      console.error("[IPC] Link analysis error:", error);
      return { success: false };
    }
  },
);

ipcMain.handle("bedrock:converse", async (_, input: Record<string, unknown>) => {
  if (!bedrockGatewayClient) {
    throw new Error(
      "Bedrock gateway unavailable: missing AWS credentials in Electron environment",
    );
  }

  const reviveBytes = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(reviveBytes);
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(obj)) {
        if (
          key === "bytes" &&
          Array.isArray(v) &&
          v.every((n) => typeof n === "number")
        ) {
          out[key] = Uint8Array.from(v as number[]);
        } else {
          out[key] = reviveBytes(v);
        }
      }
      return out;
    }
    return value;
  };

  const commandInput = reviveBytes(input);
  const response = await bedrockGatewayClient.send(
    new ConverseCommand(commandInput as any),
  );
  return response;
});

// File reading for AI Memory analysis
ipcMain.handle("file:readFileAsBase64", async (_, filePath: string) => {
  try {
    const MAX_SIZE_FOR_INLINE = 20 * 1024 * 1024; // 20MB limit for inline data
    const stat = await fs.stat(filePath);

    if (stat.size > MAX_SIZE_FOR_INLINE) {
      throw new Error(
        `File too large for inline analysis (${(stat.size / 1024 / 1024).toFixed(1)} MB). Max: 20MB`,
      );
    }

    const buffer = await fs.readFile(filePath);
    return buffer.toString("base64");
  } catch (error) {
    console.error("Failed to read file as base64:", error);
    throw error;
  }
});

// Get file size (for determining upload strategy)
ipcMain.handle("file:getFileSize", async (_, filePath: string) => {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch (error) {
    console.error("Failed to get file size:", error);
    return 0;
  }
});

// =============================================
// AI Memory — File-based persistence (project-specific)
// =============================================
const MEMORY_BASE_DIR = path.join(app.getPath("userData"), "ai_memory");

function getProjectMemoryPaths(projectId?: string) {
  const projectDir = projectId
    ? path.join(MEMORY_BASE_DIR, "projects", projectId)
    : path.join(MEMORY_BASE_DIR, "default");

  return {
    dir: projectDir,
    index: path.join(projectDir, "memory.json"),
    analyses: path.join(projectDir, "analyses"),
  };
}

async function ensureMemoryDirs(projectId?: string) {
  const paths = getProjectMemoryPaths(projectId);
  await fs.mkdir(paths.dir, { recursive: true });
  await fs.mkdir(paths.analyses, { recursive: true });
}

// Save full memory state to disk
ipcMain.handle("memory:save", async (_, data: any) => {
  try {
    const projectId = data.projectId;
    const paths = getProjectMemoryPaths(projectId);
    await ensureMemoryDirs(projectId);
    await fs.writeFile(paths.index, JSON.stringify(data, null, 2), "utf-8");
    console.log(
      `[Memory] Saved ${data.entries?.length || 0} entries to ${paths.index} (Project: ${projectId || "default"})`,
    );
    return { success: true, path: paths.index };
  } catch (error) {
    console.error("[Memory] Failed to save:", error);
    return { success: false, error: String(error) };
  }
});

// Load memory state from disk
ipcMain.handle("memory:load", async (_, projectId?: string) => {
  try {
    const paths = getProjectMemoryPaths(projectId);
    await ensureMemoryDirs(projectId);
    const data = await fs.readFile(paths.index, "utf-8");
    const parsed = JSON.parse(data);
    console.log(
      `[Memory] Loaded ${parsed.entries?.length || 0} entries from disk (Project: ${projectId || "default"})`,
    );
    return { success: true, data: parsed };
  } catch (error: any) {
    if (error.code === "ENOENT") {
      // File doesn't exist yet, that's fine
      console.log(
        `[Memory] No existing memory file found for project ${projectId || "default"}, starting fresh`,
      );
      return { success: true, data: { entries: [] } };
    }
    console.error("[Memory] Failed to load:", error);
    return { success: false, error: String(error) };
  }
});

//  TESTING MODE - Read all memory files from a directory
ipcMain.handle("read-memory-files", async (_, memoryDir: string) => {
  try {
    console.log(` [TESTING MODE] Reading memory from ${memoryDir}...`);

    // Try to read the default project memory first
    const defaultPath = path.join(memoryDir, "default", "memory.json");

    try {
      const data = await fs.readFile(defaultPath, "utf-8");
      const parsed = JSON.parse(data);
      console.log(
        ` [TESTING MODE] Loaded ${parsed.entries?.length || 0} entries from ${defaultPath}`,
      );
      return { success: true, entries: parsed.entries || [] };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        console.log(` [TESTING MODE] No memory.json found in ${defaultPath}`);
        return { success: true, entries: [] };
      }
      throw err;
    }
  } catch (error) {
    console.error("[TESTING MODE] Failed to read memory files:", error);
    return { success: false, error: String(error), entries: [] };
  }
});

// Save an individual analysis as a human-readable Markdown file
ipcMain.handle(
  "memory:saveAnalysisMarkdown",
  async (_, entry: any, projectId?: string) => {
    try {
      const paths = getProjectMemoryPaths(projectId);
      await ensureMemoryDirs(projectId);

      // Sanitize filename
      const safeName = entry.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const mdPath = path.join(paths.analyses, `${safeName}.md`);

      let md = `# Media Analysis: ${entry.fileName}\n\n`;
      md += `- **Type:** ${entry.mediaType}\n`;
      md += `- **File:** ${entry.filePath}\n`;
      md += `- **MIME:** ${entry.mimeType}\n`;
      if (entry.duration)
        md += `- **Duration:** ${entry.duration.toFixed(1)}s\n`;
      md += `- **Status:** ${entry.status}\n`;
      md += `- **Analyzed:** ${entry.updatedAt}\n\n`;

      md += `## Summary\n${entry.summary}\n\n`;

      if (entry.tags && entry.tags.length > 0) {
        md += `## Tags\n${entry.tags.map((t: string) => `\`${t}\``).join(", ")}\n\n`;
      }

      md += `## Detailed Analysis\n${entry.analysis}\n\n`;

      if (entry.visualInfo) {
        md += `## Visual Information\n`;
        if (entry.visualInfo.subjects?.length)
          md += `- **Subjects:** ${entry.visualInfo.subjects.join(", ")}\n`;
        if (entry.visualInfo.style)
          md += `- **Style:** ${entry.visualInfo.style}\n`;
        if (entry.visualInfo.dominantColors?.length)
          md += `- **Colors:** ${entry.visualInfo.dominantColors.join(", ")}\n`;
        if (entry.visualInfo.composition)
          md += `- **Composition:** ${entry.visualInfo.composition}\n`;
        if (entry.visualInfo.quality)
          md += `- **Quality:** ${entry.visualInfo.quality}\n`;
        md += "\n";
      }

      if (entry.audioInfo) {
        md += `## Audio Information\n`;
        md += `- **Speech:** ${entry.audioInfo.hasSpeech ? "Yes" : "No"}\n`;
        md += `- **Music:** ${entry.audioInfo.hasMusic ? "Yes" : "No"}\n`;
        if (entry.audioInfo.languages?.length)
          md += `- **Languages:** ${entry.audioInfo.languages.join(", ")}\n`;
        if (entry.audioInfo.mood) md += `- **Mood:** ${entry.audioInfo.mood}\n`;
        if (entry.audioInfo.transcriptSummary)
          md += `- **Transcript Summary:** ${entry.audioInfo.transcriptSummary}\n`;
        md += "\n";
      }

      if (entry.scenes && entry.scenes.length > 0) {
        md += `## Scenes\n`;
        for (const scene of entry.scenes) {
          md += `- **[${scene.startTime.toFixed(1)}s - ${scene.endTime.toFixed(1)}s]** ${scene.description}\n`;
        }
        md += "\n";
      }

      await fs.writeFile(mdPath, md, "utf-8");
      console.log(`[Memory] Saved analysis markdown: ${mdPath}`);
      return { success: true, path: mdPath };
    } catch (error) {
      console.error("[Memory] Failed to save markdown:", error);
      return { success: false, error: String(error) };
    }
  },
);

// Get memory directory path (returns base directory)
ipcMain.handle("memory:getDir", async () => {
  const paths = getProjectMemoryPaths(); // Default project
  await ensureMemoryDirs();
  return { dir: MEMORY_BASE_DIR, index: paths.index, analyses: paths.analyses };
});

// ===========================
// YouTube Upload Handlers
// ===========================

// Check if user is authenticated with YouTube
ipcMain.handle("youtube:isAuthenticated", async () => {
  try {
    return isAuthenticated();
  } catch (error) {
    console.error("[YouTube] Error checking authentication:", error);
    return false;
  }
});

// Authenticate user with YouTube
ipcMain.handle("youtube:authenticate", async () => {
  try {
    if (!mainWindow) {
      throw new Error("Main window not available");
    }
    const success = await authenticateUser(mainWindow);
    return success;
  } catch (error) {
    console.error("[YouTube] Authentication error:", error);
    throw error;
  }
});

// Logout from YouTube
ipcMain.handle("youtube:logout", async () => {
  try {
    return youtubeLogout();
  } catch (error) {
    console.error("[YouTube] Logout error:", error);
    return false;
  }
});

// Upload video to YouTube
ipcMain.handle("youtube:uploadVideo", async (event, { filePath, metadata }) => {
  try {
    console.log("[YouTube] Starting upload:", filePath);
    
    const videoId = await uploadVideo(filePath, metadata, (progress) => {
      // Send progress updates to renderer
      if (mainWindow) {
        mainWindow.webContents.send("youtube:uploadProgress", progress);
      }
    });

    console.log("[YouTube] Upload completed:", videoId);
    return { success: true, videoId };
  } catch (error: any) {
    console.error("[YouTube] Upload error:", error);
    return { success: false, error: error.message || "Upload failed" };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
