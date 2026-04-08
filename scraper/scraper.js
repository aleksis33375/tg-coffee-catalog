/**
 * Парсер меню кофейни Hot Black с Яндекс Карт
 * Использует Puppeteer — реальный браузер, рендерит JS-страницы
 *
 * Запуск: node scraper.js
 * Результат: ../tg-app/data/menu.json и папка ../tg-app/img/
 */

const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');
const https     = require('https');
const http      = require('http');

// ── Настройки ──────────────────────────────────────────────
const URL_TO_SCRAPE = 'https://yandex.com/maps/org/hot_black/6464329332/menu/';

const OUTPUT_JSON = path.join(__dirname, '../tg-app/data/menu.json');
const OUTPUT_IMG  = path.join(__dirname, '../tg-app/img');

// Соответствие категорий с Яндекс Карт → наши категории
// Ключ — фрагмент названия категории (lowercase), значение — наша категория
const CATEGORY_MAP = {
  'кофе':         'Кофе',
  'эспрессо':     'Кофе',
  'молочный':     'Кофе',
  'cappuccino':   'Кофе',
  'latte':        'Кофе',
  'альтернатива': 'Альтернатива',
  'фильтр':       'Альтернатива',
  'cold brew':    'Альтернатива',
  'колд':         'Альтернатива',
  'pour':         'Альтернатива',
  'чай':          'Чай',
  'tea':          'Чай',
  'матча':        'Чай',
  'десерт':       'Десерты',
  'выпечка':      'Десерты',
  'еда':          'Десерты',
  'снек':         'Десерты',
  'брауни':       'Десерты',
  'торт':         'Десерты',
};

// Эмоджи и градиенты по умолчанию для каждой нашей категории
const CATEGORY_DEFAULTS = {
  'Кофе':         { emoji: '☕', gradient: ['#5C3A21', '#C8813A'] },
  'Альтернатива': { emoji: '🫗', gradient: ['#2D5C3A', '#4A7C59'] },
  'Чай':          { emoji: '🍵', gradient: ['#2D5C20', '#4A7A3A'] },
  'Десерты':      { emoji: '🍫', gradient: ['#3C1A0A', '#6B3A1A'] },
};

// Дополнительные эмоджи для конкретных позиций
const ITEM_EMOJI_MAP = {
  'эспрессо':   '☕', 'espresso':    '☕',
  'американо':  '🫖', 'americano':   '🫖',
  'капучино':   '☕', 'cappuccino':  '☕',
  'латте':      '🥛', 'latte':       '🥛',
  'флэт':       '☕', 'flat white':  '☕',
  'раф':        '🍦', 'raf':         '🍦',
  'матча':      '🍵', 'matcha':      '🍵',
  'пуровер':    '🫗', 'pour over':   '🫗',
  'аэропресс':  '⚗️', 'aeropress':   '⚗️',
  'колд':       '🧊', 'cold brew':   '🧊',
  'чай':        '🍵', 'tea':         '🍵',
  'брауни':     '🍫', 'brownie':     '🍫',
  'тирамису':   '🍮', 'tiramisu':    '🍮',
  'эклер':      '🥐', 'eclair':      '🥐',
  'круассан':   '🥐', 'croissant':   '🥐',
  'торт':       '🎂', 'cake':        '🎂',
  'маффин':     '🧁', 'muffin':      '🧁',
  'чизкейк':    '🍰', 'cheesecake':  '🍰',
};


// ── Утилиты ────────────────────────────────────────────────

/** Скачать файл по URL и сохранить локально */
function downloadFile(fileUrl, destPath) {
  return new Promise((resolve, reject) => {
    // Пропускаем уже скачанные
    if (fs.existsSync(destPath)) return resolve(destPath);

    const proto = fileUrl.startsWith('https') ? https : http;
    const file  = fs.createWriteStream(destPath);

    proto.get(fileUrl, res => {
      // Следуем редиректам (Яндекс CDN часто редиректит)
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(destPath); });
    }).on('error', err => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/** Подобрать нашу категорию по названию категории с Яндекса */
function mapCategory(yandexCategory) {
  const lower = (yandexCategory || '').toLowerCase();
  for (const [key, val] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(key)) return val;
  }
  return null; // категория не нужна нам
}

/** Подобрать эмоджи по названию позиции */
function pickEmoji(name, defaultEmoji) {
  const lower = (name || '').toLowerCase();
  for (const [key, emoji] of Object.entries(ITEM_EMOJI_MAP)) {
    if (lower.includes(key)) return emoji;
  }
  return defaultEmoji;
}

/** Безопасное имя файла из URL */
function urlToFilename(url, id) {
  const ext = url.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || 'jpg';
  return `item_${id}.${ext}`;
}


// ── Главная функция ─────────────────────────────────────────

async function scrape() {
  console.log('🚀 Запускаем браузер...');

  const browser = await puppeteer.launch({
    headless: false,  // показываем браузер — Яндекс меньше блокирует видимые браузеры
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--lang=ru-RU,ru',
      '--window-size=1280,900',
      '--disable-blink-features=AutomationControlled',
    ],
    defaultViewport: null,
  });

  const page = await browser.newPage();

  // Убираем признаки автоматизации — иначе Яндекс покажет капчу
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['ru-RU', 'ru', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
  });

  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8' });

  // Перехватываем сетевые ответы — ищем JSON с данными меню из API Яндекса
  const capturedMenuData = [];
  page.on('response', async response => {
    const url = response.url();
    // Яндекс Карты загружают меню через свой API
    if (
      (url.includes('api-maps') || url.includes('maps-api') || url.includes('geocoder') ||
       url.includes('organization') || url.includes('menu') || url.includes('business')) &&
      response.headers()['content-type']?.includes('json')
    ) {
      try {
        const json = await response.json();
        const text = JSON.stringify(json);
        // Ищем ответы, содержащие признаки меню: цена + название
        if (text.includes('"price"') || text.includes('"cost"') || text.includes('₽')) {
          capturedMenuData.push({ url, data: json });
          console.log(`  📡 Перехвачен API-ответ с данными: ${url.slice(0, 80)}...`);
        }
      } catch { /* не JSON — пропускаем */ }
    }
  });

  console.log(`🌐 Открываем страницу: ${URL_TO_SCRAPE}`);

  try {
    await page.goto(URL_TO_SCRAPE, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
  } catch (err) {
    console.error('❌ Не удалось загрузить страницу:', err.message);
    await browser.close();
    return;
  }

  // Проверяем — не капча ли это
  const title = await page.title();
  console.log(`📄 Заголовок страницы: "${title}"`);

  if (title.includes('робот') || title.includes('captcha') || title.includes('robot')) {
    console.log('🛑 Яндекс показал капчу. Браузер открыт — реши капчу вручную.');
    console.log('   После решения скрипт продолжит автоматически...');
    // Ждём пока заголовок страницы сменится (капча решена)
    await page.waitForFunction(
      () => !document.title.includes('робот') && !document.title.includes('captcha'),
      { timeout: 120000 }
    );
    console.log('✅ Капча пройдена, продолжаем...');
  }

  console.log('⏳ Ждём загрузки меню...');
  await new Promise(r => setTimeout(r, 4000));

  // Скроллим чтобы подгрузить lazy-контент
  console.log('📜 Скроллим страницу...');
  await autoScroll(page);
  await new Promise(r => setTimeout(r, 3000));

  // ── Сначала пробуем данные из перехваченных API-запросов ──
  let rawItems = [];

  if (capturedMenuData.length > 0) {
    console.log(`📡 Анализируем ${capturedMenuData.length} перехваченных API-ответов...`);
    rawItems = extractFromApiData(capturedMenuData);
  }

  // ── Если API не дал данных — парсим DOM ──
  if (rawItems.length === 0) {
    console.log('🔍 Ждём появления карточек меню в DOM...');

    // Ждём реального появления карточек с правильными классами Яндекса
    try {
      await page.waitForSelector('.business-full-items-grouped-view__item', { timeout: 15000 });
    } catch {
      console.warn('⚠️  Карточки не появились, пробуем парсить что есть');
    }

    await new Promise(r => setTimeout(r, 2000));

    rawItems = await page.evaluate(() => {
      const results = [];

      // Яндекс Карты: каждая секция — .business-full-items-grouped-view__category
      // Внутри — заголовок и список карточек .business-full-items-grouped-view__item
      const sections = document.querySelectorAll('.business-full-items-grouped-view__category');

      for (const section of sections) {
        // Заголовок категории
        const categoryEl = section.querySelector('.business-full-items-grouped-view__title');
        const category = categoryEl?.textContent?.trim() || '';

        // Карточки товаров в секции
        const items = section.querySelectorAll('.business-full-items-grouped-view__item');

        for (const card of items) {
          // Фото
          const imgEl = card.querySelector('img');
          let photoUrl = imgEl?.src || imgEl?.getAttribute('data-src') || '';
          if (photoUrl.includes('data:') || photoUrl.includes('1x1') || photoUrl.includes('stub')) photoUrl = '';

          // Название — ищем первый значимый текстовый узел
          const allText = card.innerText || card.textContent || '';
          const lines = allText.split('\n').map(s => s.trim()).filter(Boolean);

          // Первая строка — название, последняя с ₽ — цена
          const name = lines[0] || '';
          const priceLine = lines.find(l => /\d+/.test(l) && l.includes('₽'));
          const priceMatch = priceLine?.match(/(\d[\d\s]*)/);
          const price = priceMatch ? parseInt(priceMatch[1].replace(/\s/g, ''), 10) : 0;

          // Описание — строки между названием и ценой
          const desc = lines.slice(1).filter(l => !/^\d+/.test(l) && !l.includes('₽') && !l.includes('шт')).join(' ');

          if (name && price > 0) {
            results.push({ name, price, description: desc, photoUrl, category });
          }
        }
      }

      // Запасной вариант если секции не найдены
      if (results.length === 0) {
        const allBlocks = Array.from(document.querySelectorAll('div, li'));
        const cards = allBlocks.filter(el => {
          const text = el.textContent || '';
          return /\d+\s*₽/.test(text) && text.length < 300 && text.trim().length > 5;
        });
        for (const card of cards) {
          const text = card.textContent.trim();
          const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
          const name = lines[0] || '';
          const priceMatch = text.match(/(\d+)\s*₽/);
          const price = priceMatch ? parseInt(priceMatch[1]) : 0;
          const imgEl = card.querySelector('img');
          const photoUrl = imgEl?.src || '';
          if (name && price > 0) results.push({ name, price, description: '', photoUrl, category: '' });
        }
      }

      return results;
    });
  }

  console.log(`📋 Найдено позиций: ${rawItems.length}`);

  if (rawItems.length === 0) {
    console.log('⚠️  Позиции не найдены. Сохраняем HTML для диагностики...');
    const html = await page.content();
    fs.writeFileSync(path.join(__dirname, 'debug.html'), html, 'utf8');
    console.log('   HTML → scraper/debug.html');
    // Сохраняем скриншот для наглядности
    await page.screenshot({ path: path.join(__dirname, 'debug.png'), fullPage: true });
    console.log('   Скриншот → scraper/debug.png');
    await browser.close();
    return;
  }

  await browser.close();

  // ── Готовим папку для изображений ──
  if (!fs.existsSync(OUTPUT_IMG)) fs.mkdirSync(OUTPUT_IMG, { recursive: true });

  // ── Фильтруем и сортируем ──
  const OUR_CATEGORIES = ['Кофе', 'Альтернатива', 'Чай', 'Десерты'];

  // Порядок популярности внутри категорий (чем ниже индекс — тем популярнее)
  const POPULARITY = {
    'Кофе':         ['капучино','латте','американо','флэт','раф','эспрессо','мокко','глясе'],
    'Альтернатива': ['колд','пуровер','аэропресс','кемекс','сифон','фильтр'],
    'Чай':          ['матча','масала','латте','облепих','имбир','ромашк','мятн'],
    'Десерты':      ['брауни','чизкейк','тирамису','эклер','круассан','маффин','торт'],
  };

  function popularityScore(name, category) {
    const lower = name.toLowerCase();
    const order = POPULARITY[category] || [];
    const idx   = order.findIndex(k => lower.includes(k));
    return idx === -1 ? 99 : idx;
  }

  let id = 1;
  const finalItems = [];

  for (const ourCat of OUR_CATEGORIES) {
    // Отбираем подходящие позиции
    const catItems = rawItems
      .filter(item => {
        const mapped = mapCategory(item.category);
        return mapped === ourCat;
      })
      .sort((a, b) => popularityScore(a.name, ourCat) - popularityScore(b.name, ourCat));

    // Если с Яндекса не пришло ни одной позиции в эту категорию — пропускаем
    if (catItems.length === 0) {
      console.log(`⚠️  Категория «${ourCat}» — позиции не найдены в данных Яндекса`);
      continue;
    }

    for (let i = 0; i < catItems.length; i++) {
      const item = catItems[i];
      const defaults = CATEGORY_DEFAULTS[ourCat];

      // Бейдж: первые 2 в категории — «хит», следующая новинка (если есть слово «new»)
      let badge = null;
      if (i === 0) badge = 'хит';
      else if (i === 1 && catItems.length > 3) badge = 'хит';
      else if ((item.name + item.description).toLowerCase().includes('нов')) badge = 'новинка';

      // Эмоджи по названию
      const emoji = pickEmoji(item.name, defaults.emoji);

      // Скачиваем фото если есть
      let localPhoto = null;
      if (item.photoUrl && item.photoUrl.startsWith('http')) {
        const filename = urlToFilename(item.photoUrl, id);
        const destPath = path.join(OUTPUT_IMG, filename);
        try {
          await downloadFile(item.photoUrl, destPath);
          localPhoto = `img/${filename}`;
          process.stdout.write(`  📷 Фото: ${filename}\n`);
        } catch (e) {
          console.warn(`  ⚠️  Не удалось скачать фото для «${item.name}»: ${e.message}`);
        }
      }

      finalItems.push({
        id,
        category: ourCat,
        name: item.name,
        price: item.price,
        description: item.description || `${item.name} — ${ourCat.toLowerCase()} от Hot Black Coffee.`,
        photo: localPhoto,
        badge,
        rating: null,
        review: null,
        emoji,
        gradient: defaults.gradient,
      });

      id++;
    }
  }

  // ── Собираем итоговый JSON ──
  const output = {
    manager: 'coffee_manager',
    cafe: {
      name: 'Hot Black Coffee',
      tagline: 'Настоящий кофе в твоём городе',
    },
    categories: ['Все', ...OUR_CATEGORIES],
    items: finalItems,
  };

  // Убеждаемся что папка data/ существует
  const dataDir = path.dirname(OUTPUT_JSON);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf8');

  console.log('\n✅ Готово!');
  console.log(`   Позиций в JSON: ${finalItems.length}`);
  console.log(`   Файл: ${OUTPUT_JSON}`);
  OUR_CATEGORIES.forEach(cat => {
    const count = finalItems.filter(i => i.category === cat).length;
    console.log(`   • ${cat}: ${count} позиций`);
  });
}


// ── Извлечение данных из перехваченных API-ответов ─────────
function extractFromApiData(apiResponses) {
  const results = [];

  for (const { data } of apiResponses) {
    // Рекурсивно ищем объекты с полями name + price
    findMenuItems(data, results);
  }

  // Убираем дубликаты по имени
  const seen = new Set();
  return results.filter(item => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

function findMenuItems(obj, results, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    for (const item of obj) findMenuItems(item, results, depth + 1);
    return;
  }

  // Проверяем — похоже ли это на позицию меню
  const hasName  = typeof obj.name === 'string' && obj.name.length > 1;
  const hasPrice = typeof obj.price === 'number' ||
                   typeof obj.cost  === 'number' ||
                   (typeof obj.price === 'object' && obj.price?.value);

  if (hasName && hasPrice) {
    const price = typeof obj.price === 'number' ? obj.price
      : typeof obj.cost === 'number'   ? obj.cost
      : obj.price?.value               ? parseInt(obj.price.value) : 0;

    const photoUrl = obj.photo?.uri || obj.photo?.url ||
                     obj.image?.uri || obj.image?.url ||
                     obj.images?.[0]?.uri || obj.images?.[0]?.url || '';

    results.push({
      name:        obj.name,
      price:       price,
      description: obj.description || obj.desc || '',
      category:    obj.category?.name || obj.categoryName || obj.section || '',
      photoUrl:    photoUrl,
    });
    return;
  }

  // Рекурсивно обходим все поля
  for (const val of Object.values(obj)) {
    findMenuItems(val, results, depth + 1);
  }
}


// ── Автоскролл страницы (подгружает lazy-контент) ──────────
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total  = 0;
      const dist = 400;
      const delay = 300;
      const timer = setInterval(() => {
        window.scrollBy(0, dist);
        total += dist;
        if (total >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, delay);
    });
  });
  // Ждём дополнительной подгрузки после скролла
  await new Promise(r => setTimeout(r, 2000));
}


// ── Запуск ──────────────────────────────────────────────────
scrape().catch(err => {
  console.error('💥 Критическая ошибка:', err);
  process.exit(1);
});
