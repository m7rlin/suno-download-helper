# Suno Download Helper

You can download all YOUR created songs from Suno AI using this helper.

> Create only for educational purposes. Use at your own risk.

## Motivation

Suno AI does not provide a way to download all your created songs at once. This tool automates the process of scrolling through your song list and downloading each song.

![image](docs/chrome.png)

## Setup

1. Download Chrome

On desktop right click on the chrome icon. Select propoerties and set: `"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir=C:\Users\<your-user>\AppData\Local\Google\Chrome`

> Replace `<your-user>` with your actual user name.

Run chrome using this shortcut.

> Make sure no other chrome instance is running. If other instance is running, close them all first.

2. Login to Suno.com in the Chrome instance you started with remote debugging.

3. Install Node.js and pnpm
4. Clone this repository

5. Install dependencies and run dev server

```
pnpm install
pnpm run dev
```

> Notice! Use dev command not build because typescript check are not completed which will cause build to fail.

## Modify chrome shortcut

"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222

## scrollContainer

In the browser:

```js
document.querySelectorAll('div[id*="tabpanel-songs"]')[1].firstChild;
```

## License under GPLv3.
