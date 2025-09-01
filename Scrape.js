const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let browser = null;
    try {
        const body = JSON.parse(event.body);
        const { action, url } = body;

        // Final, stable configuration with the critical typo fix
        browser = await puppeteer.launch({
            args: [
                ...chromium.args,
                '--no-sandbox',
                '--disable-setuid-sandbox',
            ],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(), // CRITICAL FIX: Added parentheses ()
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        if (action === 'getLinks') {
            await page.goto(url, { waitUntil: 'domcontentloaded' });
            const links = await page.$$eval('a[data-cy="listing-item-link"]', (anchors) =>
                anchors.map((a) => a.href)
            );
            return { statusCode: 200, body: JSON.stringify({ links }) };
        }

        if (action === 'processAd') {
            const { formData, processedContacts } = body;
            let userName = 'Nieznany';
            let userPhone = 'Nieznany';
            
            try {
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
                
                try {
                     userName = await page.$eval('[data-cy="advertiser-card-name"]', el => el.textContent.trim());
                     const phoneButton = await page.waitForSelector('[data-cy="ask-about-number"]', { timeout: 5000 });
                     await phoneButton.click();
                     const phoneElement = await page.waitForSelector('a[href^="tel:"]', { timeout: 5000 });
                     userPhone = await page.evaluate(el => el.textContent.trim(), phoneElement);
                } catch(e) {
                    throw new Error(`Nie udało się pobrać danych kontaktowych (Nazwa/Telefon). Strona mogła się zmienić. Szczegóły: ${e.message}`);
                }

                const contactKey = `${userName}-${userPhone}`;
                if (processedContacts && processedContacts.includes(contactKey)) {
                    return { statusCode: 200, body: JSON.stringify({ status: 'skipped', userName, userPhone }) };
                }
                
                try {
                    await page.type('#name', formData.name, { delay: 50 });
                    await page.type('#email', formData.email, { delay: 50 });
                    await page.type('#phone', formData.phone, { delay: 50 });
                    await page.type('#message', formData.message, { delay: 50 });
                    await page.click('input[name="rules_confirmation"] + label');
                } catch(e) {
                    throw new Error(`Nie udało się wypełnić formularza kontaktowego. Sprawdź selektory. Szczegóły: ${e.message}`);
                }
                
                // UNCOMMENT THE LINE BELOW TO ENABLE SENDING
                // await page.click('button[data-cy="contact-form-send-button"]');

                return { statusCode: 200, body: JSON.stringify({ status: 'success', userName, userPhone }) };

            } catch (error) {
                 return {
                    statusCode: 200,
                    body: JSON.stringify({
                        status: 'error',
                        error: error.message,
                        userName,
                        userPhone
                    })
                };
            }
        }

        return { statusCode: 400, body: JSON.stringify({ error: 'Nieprawidłowa akcja' }) };

    } catch (error) {
        console.error("Critical scraper error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: `Krytyczny błąd scrapera: ${error.message}` })
        };
    } finally {
        if (browser !== null) {
            await browser.close();
        }
    }
};

