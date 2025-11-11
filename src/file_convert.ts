import { execFile } from "child_process";
import { promisify } from "util";
import fetch from "node-fetch";
import * as path from "path";
import * as fs from "fs";
import type { SongData } from "./index.js";
import { fileURLToPath } from "url";
const asyncCopyFile = promisify(fs.copyFile);
const asyncDeleteFile = promisify(fs.rm);
const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export async function convertWavToFlacAndAlac(
  metadata: SongData
): Promise<{ flac: string; alac: string; wav: string }> {
  const songId = metadata.clipId;
  const imageDlDir = path.join(__dirname, "downloads", "images");
  const nasConfig = path.join(__dirname, "..","nasloc");
  let nasPath: string = "";
  let moveToNas: boolean = false;
  let nasFlacDir: string = "";
  let nasAlacDir: string = "";
  let nasWavDir: string = "";
  if (fs.existsSync(nasConfig)) {
    nasPath = path.join(fs.readFileSync(nasConfig, "utf8"));
    if (fs.existsSync(nasPath)) {
      console.log(`      ->  Found NAS at ${nasPath} `);
      moveToNas = true;
      nasFlacDir = path.join(nasPath, "flac");
      if (!fs.existsSync(nasFlacDir)) {
        fs.mkdirSync(nasFlacDir);
      }
      nasAlacDir = path.join(nasPath, "alac");
      if (!fs.existsSync(nasAlacDir)) {
        fs.mkdirSync(nasAlacDir);
      }

      nasWavDir = path.join(nasPath, "wav");
      if (!fs.existsSync(nasWavDir)) {
        fs.mkdirSync(nasWavDir);
      }
    }
  } else {
    console.log(`      ->  Did Not Find NAS at ${nasConfig} `);

  }
  if (!fs.existsSync(imageDlDir)) {
    fs.mkdirSync(imageDlDir);
  }
  const flacDir = path.join(__dirname, "downloads", "flac");
  if (!fs.existsSync(flacDir)) {
    fs.mkdirSync(flacDir);
  }
  const alacDir = path.join(__dirname, "downloads", "alac");
  if (!fs.existsSync(alacDir)) {
    fs.mkdirSync(alacDir);
  }
  const wavDir = path.join(__dirname, "downloads", "wav");
  //this has to exist to even get here
  // 1. Fetch image
  let fullImagePath: string = "";
  const imageUrl: string = metadata.thumbnail ?? "";
  const imgUrlArr: string[] = imageUrl.split("/");
  if (imgUrlArr && imgUrlArr.length > 0) {
    console.log(`      ->  Downloading image from ${imageUrl}`);

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      console.log(`      ->  Failed to fetch image: ${imageResponse.statusText}`);
    } else {
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      //@ts-ignore
      const imagePath = path.join(imageDlDir, imgUrlArr[imgUrlArr.length - 1]);
      if (imagePath) {
        console.log(`      ->  Downloaded image to ${imagePath}`);

        fs.writeFileSync(imagePath, imageBuffer);
        fullImagePath = imagePath;
      }
    }
  }

  // 3. Prepare output paths
  const flacPath = path.join(flacDir, `${songId}.flac`);
  const alacPath = path.join(alacDir, `${songId}.m4a`);
  const wavPath = path.join(wavDir, `${songId}.wav`);
  // 4. Build metadata args

  const metadataArgs = createMetaDataArgs(metadata, false);
  const parsleyMetadataArgs = createMetaDataArgs(metadata, true);
  // 5. Convert to FLAC
  console.log(`        ->  Converting ${songId} to flac`);
  await execFileAsync(
    "ffmpeg",
    createFfmpegExecArgs(flacPath, wavPath, "flac", metadataArgs, fullImagePath)
  );
  console.log(`        ->  Done converting ${songId} to flac`);
  // 6. Convert to ALAC
  console.log(`        ->  Converting ${songId} to alac`);
  await execFileAsync(
    "ffmpeg",
    createFfmpegExecArgs(alacPath, wavPath, "alac", metadataArgs)
  );
  const atomicArgs = [
    alacPath,
    ...(fullImagePath ? ["--artwork", fullImagePath] : []),
    "--overWrite",
    ...parsleyMetadataArgs,
  ];
  console.log(
    `         ->  Adding cover and metadata to ALAC with AtomicParsley for ${songId}`
  );
  await execFileAsync("AtomicParsley", atomicArgs);
  console.log(`        ->  Done converting ${songId} to alac`);
  let finalWavPath = wavPath;
  let finalFlacPath = flacPath;
  let finalAlacPath = alacPath;
  if (moveToNas) {
    console.log(`          ->  Copying ${songId} to NAS`);
    try {
      let wavNas = path.join(nasWavDir, `${songId}.wav`);
      let alacNas = path.join(nasAlacDir, `${songId}.m4a`);
      let flacNas = path.join(nasFlacDir, `${songId}.flac`);
      copyToNAS(wavPath, wavNas, "WAV");
      copyToNAS(flacPath, flacNas, "WAV");
      copyToNAS(alacPath, alacNas, "WAV");
    } catch (err) {
      console.log(
        `       --> Error copying ${songId} to NAS! error: ${JSON.stringify(err)}`
      );
    }
    console.log(`          ->  Done copying ${songId} to NAS`);
  }
 
  fs.rmSync(fullImagePath);

  return { flac: finalFlacPath, alac: finalAlacPath, wav: finalWavPath };
}
function copyToNAS(srcPath: string, nasPath: string, label: string) {
  asyncCopyFile(srcPath, nasPath)
    .catch((reason: any) => {
      console.log(
        `          --> Error copying ${label} ${srcPath} to NAS! error: ${JSON.stringify(
          reason
        )}`
      );
    })
    .then(() => {
      console.log(
        `          --> Copied ${label} ${srcPath} to NAS, removing original`
      );
      asyncDeleteFile(srcPath)
        .catch((reason: any) => {
          console.log(
            `          --> Error deleting ${label} ${srcPath} after copy! error: ${JSON.stringify(
              reason
            )}`
          );
        })
        .then(() => {
          console.log(`          --> Removed ${label} ${srcPath}`);
        });
    });
}

function createFfmpegExecArgs(
  outputPath: string,
  wavPath: string,
  format: "alac" | "flac",
  metadataArgs: string[],
  imagePath?: string
): string[] {
  const wavPart: string[] = ["-y", "-i", wavPath];

  let conversionPart: string[] = [
    ...(format === "flac"
      ? imagePath
        ? ["-i", imagePath, "-map", "0:a", "-map", "1:v"]
        : ["-map", "0:a"]
      : []),
    "-c:a",
    format,
    ...(format === "flac"
      ? imagePath
        ? ["-disposition:v:0", "attached_pic"]
        : []
      : []),
  ];

  const outputPart: string[] = [...metadataArgs, outputPath];

  const retVal: string[] = wavPart.concat(conversionPart).concat(outputPart);
  console.log(`      ->  running ffmpeg with command: ffmpeg ${retVal.join(" ")}`);
  return retVal;
}

export function escapeFfmpegMetadata(value: string | null): string {
  if (!value) return "";

  // Start with an empty escaped string
  let escaped = "";

  // Trim if it has leading/trailing whitespace or empty string
  const needsQuotes = /^\s|\s$/.test(value) || value === "";
  if (needsQuotes) {
    value = value.trim();
  }
  for (const char of value) {
    if (char === "\\") {
      escaped += "\\\\";
    } else if (char === "'") {
      // Close quote, add escaped single quote, reopen quote
      escaped += "'\\''";
    } else if (char === "\n") {
      //skip newlines
      continue;
    } else if (char === "\r") {
      // Skip carriage returns
      continue;
    } else {
      escaped += char;
    }
  }

  return escaped;
}

function createMetaDataArgs(metadata: SongData, parsley: boolean): string[] {
  const rawArgs = [
    "-metadata",
    `title=${escapeFfmpegMetadata(metadata.title)}`,
    "-metadata",
    `comment=${escapeFfmpegMetadata(
      `Liked:${metadata.liked ? "Yes" : "No"}|Model:Suno ${
        metadata.model
      }|Prompt:${metadata.style}`
    )}`,
    "-metadata",
    `artist=${escapeFfmpegMetadata("Gales.IO")}`,
  ];
  const metadataArgs: string[] = rawArgs.flatMap((arg: string) =>
    arg === "-metadata"
      ? parsley
        ? []
        : [arg]
      : arg.includes("=")
      ? parsley
        ? (() => {
            const i = arg.indexOf("=");
            return [`--${arg.substring(0, i)}`, arg.substring(i + 1)];
          })()
        : [arg]
      : []
  );

  return metadataArgs;
}
