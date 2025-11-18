# Suno Download Helper

You can download all YOUR created songs from Suno AI using this helper.

> Create only for educational purposes. Use at your own risk.

## Motivation

Suno AI does not provide a way to download all your created songs at once. This tool automates the process of scrolling through your song list and downloading each song.

## Setup

1. [Download Chrome](https://www.google.com/chrome/dr/download)

Windows
-------

On desktop right click on the chrome icon. Select propoerties and set: `"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir=C:\Users\<your-user>\AppData\Local\Google\Chrome`

> Replace `<your-user>` with your actual user name.

![image](docs/chrome.png)

Run chrome using this shortcut.

> Make sure no other chrome instance is running. If other instance is running, close them all first.

### Permanently modify a chrome shortcut

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

MacOS
-----
In your favorite terminal, run: 
```
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222
```
If your Chrome install is not in the normal location, swap the path out for wherever it lives.


### Startup

1. Install [Node.js](https://nodejs.org/en/download) (tested on node v22.14.0) and [pnpm](https://pnpm.io/installation)
2. Clone this repository
3. Login to Suno.com and navigate to your library, setting up any filters or playlist you want in the Chrome instance you started with remote debugging.
4. Install dependencies and run dev server

```
pnpm install
pnpm run dev
```

> Notice! Use dev command not build because typescript check are not completed which will cause build to fail.

## scrollContainer

In the browser:

```js
document.querySelectorAll('div[id*="tabpanel-songs"]')[1].firstChild;
```

## License under GPLv3.
