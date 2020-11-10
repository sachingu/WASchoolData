const puppeteer = require('puppeteer');
const fs = require('fs');
const jsonexport = require('jsonexport');

async function extractDetails(page, schoolID, retryCount) {
    let schoolOverviewUrl = `https://www.det.wa.edu.au/schoolsonline/overview.do?schoolID=${schoolID}&pageID=SO01`;
    await executeWithRetry(() => page.goto(schoolOverviewUrl, { waitUntil: 'load' }), retryCount);

    // wait for page to load
    await Promise.all([
        page.waitForSelector('.schoolNameHeading'),
        page.waitForFunction(() => document.querySelectorAll('.tableDataText').length === 1)
    ]);
    
    let overviewText = await page.evaluate(() => document.querySelector(`.tableDataText `).innerText);
    let schoolName = await page.evaluate(() => document.querySelector('.schoolNameHeading').innerText.replace(/\(\d+\)$/, '').trim());
    console.log(schoolName);

    let contactDetailsUrl = `https://www.det.wa.edu.au/schoolsonline/contact.do?schoolID=${schoolID}&pageID=CI01`;
    
    await executeWithRetry(() => page.goto(contactDetailsUrl, { waitUntil: 'load' }), retryCount);

    // wait for page to load
    await page.waitForFunction(() => document.querySelectorAll('.tableDataText').length > 1);

    let contactDetail = await page.evaluate(() => {
        const getRowText = (key) => {
            var matchedElement = [ ...document.querySelectorAll(`.tableDataText`)].find(e => e.innerText === key);
            if (matchedElement) {
                return matchedElement.parentElement.querySelector(`.tableDataText:last-child`).innerText.trim();
            }

            return '';
        }

        return {
            email: getRowText('Email - Official School Email'),
            website: getRowText('Website'),
            phone: getRowText('Phone'),
            fax: getRowText('Fax'),
            principal: getRowText('Principal'),
            manager: getRowText('Manager Corporate Services'),
            address: getRowText('Physical Address:'),
        };
    });

    return {
        schoolName,
        schoolID,
        overviewText,
        ...contactDetail
    };
}

async function executeWithRetry(functionToExecute, retryCount = 3) {
    try {
        return await functionToExecute();
    } catch (ex) {
        if (retryCount > 0) {
            return await executeWithRetry(functionToExecute, --retryCount);
        } else {
            return null;
        }
    }
}

async function scrape(url, retryCount, headless, outputPath, proxyServer) {
    const launchOptions = {
        headless
    };

    if (proxyServer) {
        launchOptions.args = [`--proxy-server=${proxyServer}`];
    }

    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await executeWithRetry(() => page.goto(url, { waitUntil: 'load' }), retryCount);
    // wait for page to load

    await page.waitForSelector('#button_bs');
    await page.click('#button_bs');
    await page.waitForSelector('#schListNav-nav a.all');
    let schoolIDs = await page.evaluate(() => [...document.querySelectorAll('#schListNav a')].map(a => /\(\'(\d+)/.exec(a.getAttribute('onclick'))).filter(m => m && m.length > 1).map(m => m[1]));
    console.log(`Scarping ${schoolIDs.length} schools`);
    let result = [];
    for (let schoolID of schoolIDs) {
        var schoolData = await executeWithRetry(() => extractDetails(page, schoolID, retryCount), retryCount);
        result.push(schoolData);
    }

    await browser.close();
    if (outputPath) {
        jsonexport(result, {
            rename: [
                'School Name',
                'School Id',
                'School Overview',
                'Email',
                'Website',
                'Phone',
                'Fax',
                'Principal',
                'Manager',
                'Address',
            ]
        }, function(err, csv){
            if(err) return console.error(err);
            fs.writeFileSync(outputPath, csv);
        });
    }

    return result;
}

module.exports.scrape = scrape;