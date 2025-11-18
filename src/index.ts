import * as puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { convertWavToFlacAndAlac } from "./file_convert";
import { ISongData } from "./ISongData";
import { TDownloadStatus } from "./TDownloadStatus";


// A helper function for creating pauses
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

function saveSongsMetadata(songs: Map<string, ISongData>) {
  const songsDir = path.join(__dirname, "songs");
  if (!fs.existsSync(songsDir)) fs.mkdirSync(songsDir, { recursive: true });
  const metadataPath = path.join(songsDir, "songs_metadata.json");
  const songsArray = Array.from(songs.values());
  fs.writeFileSync(metadataPath, JSON.stringify(songsArray, null, 2));
}

async function scrollSongIntoView(
  page: puppeteer.Page,
  scrollContainer: puppeteer.ElementHandle<HTMLDivElement>,
  clipId: string
): Promise<puppeteer.ElementHandle | null> {
  const songSelector = `div[data-clip-id="${clipId}"]`;
  let songRow = await scrollContainer.$(songSelector);

  if (songRow) {
    await songRow.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await delay(500);
    return songRow;
  }

  console.log(`  -> Song ${clipId} not visible. Scrolling to find...`);
  let stallCount = 0;
  while (stallCount < 2) {
    await scrollContainer.evaluate((el) => {
      el.scrollTop += el.clientHeight * 0.8;
    });
    await delay(1500);

    songRow = await scrollContainer.$(songSelector);
    if (songRow) {
      await songRow.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await delay(500);
      console.log(`  -> Found ${clipId} after scrolling.`);
      return songRow;
    }

    const isAtBottom = await scrollContainer.evaluate(
      (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 20
    );

    if (isAtBottom) {
      console.log("  -> Reached bottom. Resetting to top for another pass.");
      await scrollContainer.evaluate((el) => el.scrollTo(0, 0));
      stallCount++;
      await delay(1500);
    }
  }
  console.error(`  -> Could not find song ${clipId} after scrolling.`);
  return null;
}

async function clickVisibleMoreButton(
  page: puppeteer.Page,
  clipId: string
): Promise<boolean> {
  const moreButtonSelector = `div[data-clip-id="${clipId}"] button[aria-label="More menu contents"]`;
  const buttons = await page.$$(moreButtonSelector);
  if (buttons.length === 0) return false;

  for (const button of buttons) {
    if (await button.isIntersectingViewport()) {
      await button.click();
      return true;
    }
  }
  return false;
}

async function clickNextPageButton(page: puppeteer.Page | undefined): Promise<boolean> {
  if (!page) {
    return false;
  }
  //for whatever reason next does not have an aria label but previous does
  const nextButton = puppeteer.Locator.race([
    page.locator(
      "div.md\\:flex > div > div.flex-col > div button:nth-of-type(2) > svg"
    ),
    page.locator(
      '::-p-xpath(//*[@id=\\"main-container\\"]/div[2]/div/div[2]/div/div[2]/div/div/div[2]/div/button[2]/svg)'
    ),
    page.locator(
      ":scope >>> div.md\\:flex > div > div.flex-col > div button:nth-of-type(2) > svg"
    ),
  ]).setTimeout(5000);
  if (nextButton) {
    await nextButton.click();
    return true;
  }
  return false;
}

async function clickPreviousPageButton(page: puppeteer.Page): Promise<boolean> {
  const nextButton = puppeteer.Locator.race([
    page.locator('::-p-aria(Previous Page) >>>> ::-p-aria([role=\\"image\\"])'),
    page.locator(
      "div.md\\:flex > div > div.flex-col > div button:nth-of-type(1) > svg"
    ),
    page.locator(
      '::-p-xpath(//*[@id=\\"main-container\\"]/div[2]/div/div[2]/div/div[2]/div/div/div[2]/div/button[1]/svg)'
    ),
    page.locator(
      ":scope >>> div.md\\:flex > div > div.flex-col > div button:nth-of-type(1) > svg"
    ),
  ]).setTimeout(5000);
  if (nextButton) {
    await nextButton.click();
    return true;
  }
  return false;
}

async function waitUntilDownload(
  session: puppeteer.CDPSession,
  fileName: string = ""
): Promise<string> {
  return new Promise((resolve, reject) => {
    const handler = (e: puppeteer.Protocol.Browser.DownloadProgressEvent) => {
      if (e.state === "completed") {
        // Remove listener before resolving
        session.off("Browser.downloadProgress", handler);

        const downloadPath = path.resolve(__dirname, "downloads", "wav");
        if (e.filePath) {
          const originalFileName = e.filePath;
          const newFileName = `${fileName}.wav`;
          const newFilePath = path.join(downloadPath, newFileName);
          fs.renameSync(originalFileName, newFilePath);
          console.log(`    ->File renamed from ${e.guid} to ${newFileName}`);
        }

        resolve(fileName);
      } else if (e.state === "canceled") {
        // Remove listener before rejecting
        session.off("Browser.downloadProgress", handler);
        reject(new Error("Download was canceled"));
      }
    };

    // Attach listener
    session.on("Browser.downloadProgress", handler);
  });
}
let browser: puppeteer.Browser | undefined = undefined;
let exhaustedSearch: boolean = false;
async function scrapeAndDownload() {
  try {
    const dlDir = path.join(__dirname, "downloads", "wav");
    if (!fs.existsSync(dlDir)) {
      fs.mkdirSync(dlDir);
    }
    const tmpDir = path.join(__dirname, "tmp");
    let page: puppeteer.Page;
    if (!browser) {
      console.log("Connecting to the browser...");
      browser = await puppeteer.launch({
        headless: false, // Set to true for headless mode, false for visible browser
        executablePath:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        args: ["--remote-debugging-port=9222", `--user-data-dir=${tmpDir}`],
      });
      // browser = await puppeteer.connect({ browserURL: BROWSER_URL });
      // const page = (await browser.pages()).find((p) =>
      //   p.url().includes("suno.com")
      // );
      page = await browser.newPage();
      await page.goto("https://suno.com/me");
    } else {
      let pgTmp = (await browser.pages()).find((p) =>
        p.url().includes("suno.com")
      );
      if (pgTmp) {
        page = pgTmp;
      } else {
        page = await browser.newPage();
        await page.goto("https://suno.com/me");
      }
    }
    if (!page) throw new Error("Could not find the target page.");
    const session = await browser.target().createCDPSession();
    await session.send("Browser.setDownloadBehavior", {
      behavior: "allowAndName",
      downloadPath: dlDir,
      eventsEnabled: true,
    });
    session.removeAllListeners("Browser.downloadWillBegin");
    session.removeAllListeners("Browser.downloadProgress");
    session.on("Browser.downloadWillBegin", (event) => {
      console.log(
        `    -> Download will begin for browser guid ${event.guid} - ${event.suggestedFilename} from ${event.url}`
      );
    });

    // Listen for downloadProgress event
    session.on("Browser.downloadProgress", (event) => {
      if (event.state === "completed") {
        console.log(`    -> Download completed for browser guid ${event.guid}`);
      } else if (event.state === "canceled") {
        console.log(`    -> Download canceled for browser guid  ${event.guid}`);
      }
    });
    console.log(`Successfully connected to page: ${page.url()}`);

    // --- LOAD AND PREPARE DATA ---
    const allSongs = new Map<string, ISongData>();
    const songsDir = path.join(__dirname, "songs");
    const metadataPath = path.join(songsDir, "songs_metadata.json");

    if (fs.existsSync(metadataPath)) {
      console.log("Found existing metadata file. Loading...");
      try {
        const existingSongs: ISongData[] = JSON.parse(
          fs.readFileSync(metadataPath, "utf-8")
        );
        existingSongs.forEach((song) => allSongs.set(song.clipId, song));
      } catch (error) {}
      console.log(`Loaded ${allSongs.size} songs from file.`);
    }

    const scrollContainerSelector = 'div[id*="tabpanel-songs"]';
    await page.waitForSelector(scrollContainerSelector);
    //@ts-ignore
    const scrollContainers = await page.$$<HTMLDivElement>(
      scrollContainerSelector
    );
    const scrollContainer = scrollContainers?.[1];
    if (!scrollContainer)
      throw new Error("Could not find the song list's scrollable container.");
    console.log("Successfully identified the nested scroll container.");

    // Scrape page for all songs to discover new ones
    const discoveredSongs: ISongData[] = await page.$$eval(
      'div[data-testid="song-row"]',
      (rows) =>
        rows
          .map((row) => {
            const clipId = row.getAttribute("data-clip-id") || "";
            const titleEl = row.querySelector("span[title] a span");
            const title = titleEl ? titleEl.textContent : "Untitled";
            const styleEl = row.querySelector("div.flex.flex-row > div[title]");
            const style = styleEl?.getAttribute("title") || null;
            const imgEl = row.querySelector('img[alt="Song Image"]');
            const thumbnail =
              imgEl?.getAttribute("data-src") ||
              imgEl?.getAttribute("src") ||
              null;
            const durationEl = row.querySelector(
              'div[aria-label="Play Song"] span.absolute'
            );
            const duration = durationEl?.textContent?.trim() || null;
            const modelEl = Array.from(row.querySelectorAll("span")).find(
              (el) => el.textContent?.trim().startsWith("v")
            );
            const model = modelEl?.textContent?.trim() || null;
            const songUrl = `https://suno.com/song/${clipId}`;
            const likedEl = row.querySelector(
              'button[aria-label="Playbar: Like"]'
            );
            const liked =
              likedEl?.classList.contains("text-foreground-primary") || false;
            return {
              title,
              clipId,
              songUrl,
              style,
              thumbnail,
              model,
              duration,
              mp3Status: "DOWNLOADED" as TDownloadStatus,
              wavStatus: "PENDING" as TDownloadStatus,
              liked: liked,
            };
          })
          .filter((song) => song.clipId)
    );
    let foundNew: boolean = false;
    // Merge discovered songs with existing data
    discoveredSongs.forEach((song) => {
      if (!allSongs.has(song.clipId)) {
        allSongs.set(song.clipId, song);
        foundNew = true;
        exhaustedSearch = false;
      }
    });

    // Create a queue of songs that actually need processing
    const songsToProcess = Array.from(allSongs.values()).filter(
      (song) =>
        song.mp3Status !== "DOWNLOADED" || song.wavStatus !== "DOWNLOADED"
    );

    if (songsToProcess.length === 0) {
      if (exhaustedSearch) {
        console.log(
          "All discovered songs have already been downloaded. Exiting."
        );
        return;
      } else {
        exhaustedSearch = true;
      }

      if (!(await clickNextPageButton(page))) {
        console.log("--- All songs discoverd. No more pages found. ---");
        return;
      } else {
        console.log("Moving to next page");
        await delay(5000);
        session.detach();
        await scrapeAndDownload();
      }
    }

    console.log(
      `Total songs: ${allSongs.size}. Songs to process: ${songsToProcess.length}.`
    );
    saveSongsMetadata(allSongs); // Save the merged list right away

    // --- START PROCESSING ---

    for (const [index, song] of songsToProcess.entries()) {
      console.log(
        `\n--- [${index + 1}/${songsToProcess.length}] Processing: ${
          song.title
        } (${song.clipId}) ---`
      );
      const songObject = allSongs.get(song.clipId)!;

      const songRow = await scrollSongIntoView(
        page,
        scrollContainer as puppeteer.ElementHandle<HTMLDivElement>,
        song.clipId
      );
      if (!songRow) {
        console.error(
          `Skipping "${song.title}" as it could not be scrolled into view.`
        );
        songObject.mp3Status = "SKIPPED";
        songObject.wavStatus = "SKIPPED";
        saveSongsMetadata(allSongs);
        continue;
      }

      // --- MP3 Download ---
      if (songObject.mp3Status !== "DOWNLOADED") {
        songObject.mp3Status = "DOWNLOADED"; //wav only
        // try {
        //     console.log('  -> Downloading MP3...');
        //     await page.keyboard.press('Escape');
        //     await delay(200);
        //     if (!(await clickVisibleMoreButton(page, song.clipId)))
        //         throw new Error('More button not clickable for MP3');

        //     const downloadMenuItem = await page.waitForSelector(
        //         "xpath///button[.//span[text()='Download']]",
        //         { visible: true, timeout: 5000 }
        //     );
        //     await downloadMenuItem.hover();
        //     const mp3Button = await page.waitForSelector(
        //         'button[aria-label="MP3 Audio"]',
        //         { visible: true, timeout: 5000 }
        //     );
        //     await mp3Button.click();
        //     await page.waitForSelector(
        //         'button[aria-label="MP3 Audio"]',
        //         { hidden: true, timeout: 10000 }
        //     );

        //     songObject.mp3Status = 'DOWNLOADED';
        //     console.log('  -> MP3 download successful.');
        // } catch (e: any) {
        //     console.error(`  -> MP3 download FAILED: ${e.message}`);
        //     songObject.mp3Status = 'FAILED';
        //     await page.keyboard.press('Escape'); // Reset state
        // }
        saveSongsMetadata(allSongs); // Save status immediately
        await delay(1000);
      }

      // --- WAV Download ---
      if (songObject.wavStatus !== "DOWNLOADED") {
        try {
          console.log("  -> Downloading WAV...");
          const checkForExistDialog =
            "xpath///span[contains(text(), 'Download WAV Audio')]";
          let existDialog = await page.$(checkForExistDialog);
          if (existDialog) {
            const findModalCloseSearch =
              'button[aria-label="Close"]:not(.chakra-popover__close-btn)';
            let modalClose = await page.$(findModalCloseSearch);
            if (modalClose) {
              modalClose.click();
              console.log(`Closing stuck modal`);
            }
          }

          await scrollSongIntoView(
            page,
            scrollContainer as puppeteer.ElementHandle<HTMLDivElement>,
            song.clipId
          ); // Re-center element
          await page.keyboard.press("Escape");
          await delay(200);

          if (!(await clickVisibleMoreButton(page, song.clipId)))
            throw new Error("More button not clickable for WAV");

          const downloadMenuItemWav = await page.waitForSelector(
            "xpath///button[.//span[text()='Download']]",
            { visible: true, timeout: 10000 }
          );
          if (downloadMenuItemWav) {
            await downloadMenuItemWav.hover();
          } else {
            throw `Could not find download download menu item - wav for ${song.clipId}`;
          }

          const wavButton = await page.waitForSelector(
            'button[aria-label="WAV Audio"]',
            { visible: true, timeout: 10000 }
          );
          if (wavButton) {
            await wavButton.click();
          } else {
            throw `Could not find download wav button for ${song.clipId}`;
          }

          const modalTitleXPath =
            "xpath///span[contains(text(), 'Download WAV Audio')]";
          await page.waitForSelector(modalTitleXPath, {
            visible: true,
            timeout: 15000,
          });
          console.log("  -> Waiting for file generation (up to 45 seconds)...");

          const downloadButtonXPath =
            "//button[.//span[contains(text(), 'Download File')]]";
          const readyDownloadButtonSelector = `xpath/${downloadButtonXPath}[not(@disabled)]`;
          const downloadButtonElement = await page.waitForSelector(
            readyDownloadButtonSelector,
            { timeout: 60000 }
          );
          if (downloadButtonElement) {
            await downloadButtonElement.click();
          } else {
            throw `Could not find download button element for ${song.clipId}`;
          }

          await waitUntilDownload(session, songObject.clipId);
          await page.waitForFunction(
            (xpath) =>
              !document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
              ).singleNodeValue,
            {},
            modalTitleXPath.replace("xpath/", "")
          );

          songObject.wavStatus = "DOWNLOADED";
          console.log("  -> WAV download successful.");
          convertWavToFlacAndAlac(songObject);
        } catch (e: any) {
          console.error(`  -> WAV download FAILED: ${e.message}`);
          songObject.wavStatus = "FAILED";
          await page.keyboard.press("Escape"); // Reset state
        }
        saveSongsMetadata(allSongs); // Save status immediately
      }

      console.log(`--- Finished processing "${song.title}". Pausing... ---`);
    }
    await delay(3000);
    console.log("--- All songs have been processed on this page. ---");
    if (!(await clickNextPageButton(page))) {
      console.log("--- No more pages found. ---");
    } else {
      await delay(5000);
      session.detach();
      await scrapeAndDownload();
    }
  } catch (error) {
    console.error("A critical error occurred:", error);
  } finally {
    if (browser) {
      await browser.disconnect();
      console.log("Disconnected from the browser.");
    }
  }
}

scrapeAndDownload();
