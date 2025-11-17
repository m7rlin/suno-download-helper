const puppeteer = require('puppeteer'); // v23.0.0 or later

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    const timeout = 5000;
    page.setDefaultTimeout(timeout);

    {
        const targetPage = page;
        await targetPage.setViewport({
            width: 873,
            height: 1305
        })
    }
    {
        const targetPage = page;
        await targetPage.goto('https://suno.com/me?liked=true');
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('div.md\\:flex > div > div.flex-col > div button:nth-of-type(2) > svg'),
            targetPage.locator('::-p-xpath(//*[@id=\\"main-container\\"]/div[2]/div/div[2]/div/div[2]/div/div/div[2]/div/button[2]/svg)'),
            targetPage.locator(':scope >>> div.md\\:flex > div > div.flex-col > div button:nth-of-type(2) > svg')
        ])
            .setTimeout(timeout)
            .click({
              offset: {
                x: 8,
                y: 10,
              },
            });
    }

    await browser.close();

})().catch(err => {
    console.error(err);
    process.exit(1);
});
