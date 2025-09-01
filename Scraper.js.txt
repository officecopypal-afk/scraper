const puppeteer = require('puppeteer-core');
const chromium = require('chrome-aws-lambda');

const delay = ms => new Promise(res => setTimeout(res, ms));

// --- Zadanie 1: Pobieranie linków z listy wyników ---
async function getAdLinks(url, browser) {
    const page = await browser.newPage();
    try {
        await page.goto(url, { waitUntil: 'networkidle2' });
        try {
            await page.click('#onetrust-accept-btn-handler', { timeout: 3000 });
        } catch (e) { console.log('Nie znaleziono cookies.'); }
        
        const adUrls = await page.$$eval('a[data-cy="listing-item-link"]', links => links.map(a => a.href));
        return { statusCode: 200, body: JSON.stringify({ data: adUrls }) };
    } finally {
        await page.close();
    }
}

// --- Zadanie 2: Przetwarzanie pojedynczego ogłoszenia (z logiką pomijania) ---
async function processSingleAd(adUrl, userData, message, knownContacts, browser) {
    const adPage = await browser.newPage();
    let agentName = 'Ogłoszeniodawca';
    let phoneNumber = null;
    let resultData;

    try {
        await adPage.goto(adUrl, { waitUntil: 'networkidle2' });

        try {
           agentName = await adPage.$eval('div[data-cy="advertiser-card-name"] a', el => el.textContent.trim());
        } catch(e) { console.log("Nie znaleziono nazwy agenta."); }

        try {
            await adPage.click('button[data-cy="ask-about-details-phone-button"]');
            await delay(500);
            phoneNumber = await adPage.$eval('a[data-cy="phone-number"]', el => el.textContent.trim());
        } catch(e) { console.log("Nie udało się pobrać numeru telefonu."); }
        
        // NOWA LOGIKA: Sprawdź, czy kontakt był już przetwarzany
        if (agentName && phoneNumber) {
            const contactKey = `${agentName}|${phoneNumber}`;
            if (knownContacts && knownContacts.includes(contactKey)) {
                resultData = { user: agentName, phone: phoneNumber, status: 'skipped', reason: 'Duplikat w tej sesji.' };
                return { statusCode: 200, body: JSON.stringify({ data: resultData }) };
            }
        }

        // Jeśli nie jest duplikatem, kontynuuj
        await adPage.type('input[name="name"]', userData.name, { delay: 30 });
        await adPage.type('input[name="email"]', userData.email, { delay: 30 });
        await adPage.type('input[name="phone"]', userData.phone, { delay: 30 });

        const personalizedMessage = message.replace(/{nazwa_uzytkownika}/g, agentName);
        await adPage.type('textarea[name="message"]', personalizedMessage, { delay: 10 });
        
        const checkboxes = await adPage.$$('input[type="checkbox"]');
        for (const checkbox of checkboxes) {
            await checkbox.click({ delay: 50 });
        }
        await delay(200);

        // Usuń komentarz ('//'), aby włączyć FAKTYCZNE WYSYŁANIE.
        // await adPage.click('button[data-cy="contact-form-send-button"]');
        await delay(1000); // Symulacja kliknięcia
        
        resultData = { user: agentName, phone: phoneNumber, status: 'success', reason: null };
        return { statusCode: 200, body: JSON.stringify({ data: resultData }) };

    } catch (error) {
        resultData = { user: agentName, phone: phoneNumber, status: 'failure', reason: error.message.substring(0, 150) };
        return { statusCode: 200, body: JSON.stringify({ data: resultData }) };
    } finally {
        await adPage.close();
    }
}


// --- Główny Handler ---
exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let browser = null;
    try {
        const payload = JSON.parse(event.body);

        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath,
            headless: chromium.headless,
        });

        if (payload.task === 'get_links') {
            return await getAdLinks(payload.url, browser);
        } else if (payload.task === 'process_ad') {
            return await processSingleAd(payload.adUrl, payload.userData, payload.message, payload.knownContacts, browser);
        } else {
            return { statusCode: 400, body: JSON.stringify({ error: 'Nieprawidłowe zadanie (task).' }) };
        }

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Wystąpił krytyczny błąd serwera: ' + error.message }) };
    } finally {
        if (browser !== null) {
            await browser.close();
        }
    }
};

