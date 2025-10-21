import puppeteer, { Browser, Page, ElementHandle } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Recreate __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The websocket URL for your running Chrome instance
const BROWSER_URL = 'http://127.0.0.1:9222';

type DownloadStatus = 'PENDING' | 'DOWNLOADED' | 'FAILED' | 'SKIPPED';

// A helper function for creating pauses
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

interface SongData {
    title: string | null;
    clipId: string;
    style: string | null;
    thumbnail: string | null;
    model: string | null;
    duration: string | null;
    mp3Status: DownloadStatus;
    wavStatus: DownloadStatus;
    songUrl: string;
}

function saveSongsMetadata(songs: Map<string, SongData>) {
    const songsDir = path.join(__dirname, 'songs');
    if (!fs.existsSync(songsDir)) fs.mkdirSync(songsDir, { recursive: true });
    const metadataPath = path.join(songsDir, 'songs_metadata.json');
    const songsArray = Array.from(songs.values());
    fs.writeFileSync(metadataPath, JSON.stringify(songsArray, null, 2));
}

async function scrollSongIntoView(
    page: Page,
    scrollContainer: ElementHandle<HTMLDivElement>,
    clipId: string
): Promise<ElementHandle | null> {
    const songSelector = `div[data-clip-id="${clipId}"]`;
    let songRow = await scrollContainer.$(songSelector);

    if (songRow) {
        await songRow.evaluate((el) => el.scrollIntoView({ block: 'center' }));
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
            await songRow.evaluate((el) =>
                el.scrollIntoView({ block: 'center' })
            );
            await delay(500);
            console.log(`  -> Found ${clipId} after scrolling.`);
            return songRow;
        }

        const isAtBottom = await scrollContainer.evaluate(
            (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 20
        );

        if (isAtBottom) {
            console.log(
                '  -> Reached bottom. Resetting to top for another pass.'
            );
            await scrollContainer.evaluate((el) => el.scrollTo(0, 0));
            stallCount++;
            await delay(1500);
        }
    }
    console.error(`  -> Could not find song ${clipId} after scrolling.`);
    return null;
}

async function clickVisibleMoreButton(
    page: Page,
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

async function scrapeAndDownload() {
    let browser: Browser | undefined;
    try {
        console.log('Connecting to the browser...');
        browser = await puppeteer.connect({ browserURL: BROWSER_URL });
        const page = (await browser.pages()).find((p) =>
            p.url().includes('suno.com')
        );
        if (!page) throw new Error('Could not find the target page.');

        console.log(`Successfully connected to page: ${page.url()}`);

        // --- LOAD AND PREPARE DATA ---
        const allSongs = new Map<string, SongData>();
        const songsDir = path.join(__dirname, 'songs');
        const metadataPath = path.join(songsDir, 'songs_metadata.json');

        if (fs.existsSync(metadataPath)) {
            console.log('Found existing metadata file. Loading...');
            try {
                const existingSongs: SongData[] = JSON.parse(
                    fs.readFileSync(metadataPath, 'utf-8')
                );
                existingSongs.forEach((song) =>
                    allSongs.set(song.clipId, song)
                );
            } catch (error) {}
            console.log(`Loaded ${allSongs.size} songs from file.`);
        }

        const scrollContainerSelector = 'div[id*="tabpanel-songs"]';
        await page.waitForSelector(scrollContainerSelector);
        const scrollContainers = await page.$$<HTMLDivElement>(
            scrollContainerSelector
        );
        const scrollContainer = scrollContainers?.[1];
        if (!scrollContainer)
            throw new Error(
                "Could not find the song list's scrollable container."
            );
        console.log('Successfully identified the nested scroll container.');

        // Scrape page for all songs to discover new ones
        const discoveredSongs: SongData[] = await page.$$eval(
            'div[data-testid="song-row"]',
            (rows) =>
                rows
                    .map((row) => {
                        const clipId = row.getAttribute('data-clip-id') || '';
                        const titleEl = row.querySelector('span[title] a span');
                        const title = titleEl
                            ? titleEl.textContent
                            : 'Untitled';
                        const styleEl = row.querySelector(
                            'div.flex.flex-row > div[title]'
                        );
                        const style = styleEl?.getAttribute('title') || null;
                        const imgEl = row.querySelector(
                            'img[alt="Song Image"]'
                        );
                        const thumbnail =
                            imgEl?.getAttribute('data-src') ||
                            imgEl?.getAttribute('src') ||
                            null;
                        const durationEl = row.querySelector(
                            'div[aria-label="Play Song"] span.absolute'
                        );
                        const duration =
                            durationEl?.textContent?.trim() || null;
                        const modelEl = Array.from(
                            row.querySelectorAll('span')
                        ).find((el) => el.textContent?.trim().startsWith('v'));
                        const model = modelEl?.textContent?.trim() || null;
                        const songUrl = `https://suno.com/song/${clipId}`;

                        return {
                            title,
                            clipId,
                            songUrl,
                            style,
                            thumbnail,
                            model,
                            duration,
                            mp3Status: 'PENDING',
                            wavStatus: 'PENDING',
                        };
                    })
                    .filter((song) => song.clipId)
        );

        // Merge discovered songs with existing data
        discoveredSongs.forEach((song) => {
            if (!allSongs.has(song.clipId)) {
                allSongs.set(song.clipId, song);
            }
        });

        // Create a queue of songs that actually need processing
        const songsToProcess = Array.from(allSongs.values()).filter(
            (song) =>
                song.mp3Status !== 'DOWNLOADED' ||
                song.wavStatus !== 'DOWNLOADED'
        );

        if (songsToProcess.length === 0) {
            console.log(
                'All discovered songs have already been downloaded. Exiting.'
            );
            return;
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
                scrollContainer,
                song.clipId
            );
            if (!songRow) {
                console.error(
                    `Skipping "${song.title}" as it could not be scrolled into view.`
                );
                songObject.mp3Status = 'SKIPPED';
                songObject.wavStatus = 'SKIPPED';
                saveSongsMetadata(allSongs);
                continue;
            }

            // --- MP3 Download ---
            if (songObject.mp3Status !== 'DOWNLOADED') {
                try {
                    console.log('  -> Downloading MP3...');
                    await page.keyboard.press('Escape');
                    await delay(200);
                    if (!(await clickVisibleMoreButton(page, song.clipId)))
                        throw new Error('More button not clickable for MP3');

                    const downloadMenuItem = await page.waitForSelector(
                        "xpath///button[.//span[text()='Download']]",
                        { visible: true, timeout: 5000 }
                    );
                    await downloadMenuItem.hover();
                    const mp3Button = await page.waitForSelector(
                        'button[aria-label="MP3 Audio"]',
                        { visible: true, timeout: 5000 }
                    );
                    await mp3Button.click();
                    await page.waitForSelector(
                        'button[aria-label="MP3 Audio"]',
                        { hidden: true, timeout: 10000 }
                    );

                    songObject.mp3Status = 'DOWNLOADED';
                    console.log('  -> MP3 download successful.');
                } catch (e: any) {
                    console.error(`  -> MP3 download FAILED: ${e.message}`);
                    songObject.mp3Status = 'FAILED';
                    await page.keyboard.press('Escape'); // Reset state
                }
                saveSongsMetadata(allSongs); // Save status immediately
                await delay(1000);
            }

            // --- WAV Download ---
            if (songObject.wavStatus !== 'DOWNLOADED') {
                try {
                    console.log('  -> Downloading WAV...');
                    await scrollSongIntoView(
                        page,
                        scrollContainer,
                        song.clipId
                    ); // Re-center element
                    await page.keyboard.press('Escape');
                    await delay(200);

                    if (!(await clickVisibleMoreButton(page, song.clipId)))
                        throw new Error('More button not clickable for WAV');

                    const downloadMenuItemWav = await page.waitForSelector(
                        "xpath///button[.//span[text()='Download']]",
                        { visible: true, timeout: 5000 }
                    );
                    await downloadMenuItemWav.hover();
                    const wavButton = await page.waitForSelector(
                        'button[aria-label="WAV Audio"]',
                        { visible: true, timeout: 5000 }
                    );
                    await wavButton.click();

                    const modalTitleXPath =
                        "xpath///span[contains(text(), 'Download WAV Audio')]";
                    await page.waitForSelector(modalTitleXPath, {
                        visible: true,
                        timeout: 5000,
                    });
                    console.log(
                        '  -> Waiting for file generation (up to 45 seconds)...'
                    );

                    const downloadButtonXPath =
                        "//button[.//span[contains(text(), 'Download File')]]";
                    const readyDownloadButtonSelector = `xpath/${downloadButtonXPath}[not(@disabled)]`;
                    const downloadButtonElement = await page.waitForSelector(
                        readyDownloadButtonSelector,
                        { timeout: 45000 }
                    );
                    await downloadButtonElement.click();

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
                        modalTitleXPath.replace('xpath/', '')
                    );

                    songObject.wavStatus = 'DOWNLOADED';
                    console.log('  -> WAV download successful.');
                } catch (e: any) {
                    console.error(`  -> WAV download FAILED: ${e.message}`);
                    songObject.wavStatus = 'FAILED';
                    await page.keyboard.press('Escape'); // Reset state
                }
                saveSongsMetadata(allSongs); // Save status immediately
            }

            console.log(
                `--- Finished processing "${song.title}". Pausing... ---`
            );
            await delay(3000);
        }

        console.log('--- All songs have been processed. ---');
    } catch (error) {
        console.error('A critical error occurred:', error);
    } finally {
        if (browser) {
            await browser.disconnect();
            console.log('Disconnected from the browser.');
        }
    }
}

scrapeAndDownload();
