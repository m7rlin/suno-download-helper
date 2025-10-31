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
        await targetPage.goto('https://suno.com/me');
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Previous Page) >>>> ::-p-aria([role=\\"image\\"])'),
            targetPage.locator('div.md\\:flex > div > div.flex-col > div button:nth-of-type(1) > svg'),
            targetPage.locator('::-p-xpath(//*[@id=\\"main-container\\"]/div[2]/div/div[2]/div/div[2]/div/div/div[2]/div/button[1]/svg)'),
            targetPage.locator(':scope >>> div.md\\:flex > div > div.flex-col > div button:nth-of-type(1) > svg')
        ])
            .setTimeout(timeout)
            .click({
              offset: {
                x: 0,
                y: 13,
              },
            });
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
                x: 3,
                y: 8,
              },
            });
    }

    await browser.close();

})().catch(err => {
    console.error(err);
    process.exit(1);
});
