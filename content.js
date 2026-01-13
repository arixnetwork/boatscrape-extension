// Flag to indicate content script is ready
window.boatscrapeReady = true;

// Load SheetJS from CDN
(function() {
  if (!window.XLSX_LOADED) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload = () => {
      window.XLSX_LOADED = true;
    };
    document.head.appendChild(script);
  }
})();

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeProducts') {
    // Handle the request asynchronously
    scrapeProductsHandler(request)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    
    // Return true to indicate async response
    return true;
  }
});

async function scrapeProductsHandler(request) {
  try {
    let allProducts = [];
    let currentPage = 1;
    let totalPages = 1;
    
    const initialData = await scrapeCurrentPage(request.fields);
    allProducts = [...initialData.products];
    
    if (request.scrapeAllPages) {
      totalPages = detectTotalPages() || 1;
      
      // Send progress update
      chrome.runtime.sendMessage({
        type: 'progressUpdate',
        current: currentPage,
        total: totalPages
      });
      
      while (currentPage < totalPages) {
        currentPage++;
        const nextPageUrl = getNextPageUrl(currentPage);
        if (!nextPageUrl) break;
        
        try {
          const pageData = await scrapePage(nextPageUrl, request.fields);
          allProducts = [...allProducts, ...pageData.products];
          
          chrome.runtime.sendMessage({
            type: 'progressUpdate',
            current: currentPage,
            total: totalPages
          });
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.warn(`Failed to scrape page ${currentPage}:`, error);
        }
      }
    }
    
    let outputData;
    switch(request.format) {
      case 'csv':
        outputData = convertToCSV(allProducts, request.fields);
        break;
      case 'xlsx':
        outputData = await convertToXLSX(allProducts, request.fields);
        break;
      case 'json':
        outputData = JSON.stringify(allProducts, null, 2);
        break;
      default:
        throw new Error('Unsupported format');
    }
    
    return { 
      success: true, 
      count: allProducts.length,
      data: outputData
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Rest of the functions remain the same as before...
async function scrapeCurrentPage(fields) {
  await waitForDynamicContent();
  return extractProductsFromPage(fields);
}

async function scrapePage(url, fields) {
  return new Promise((resolve, reject) => {
    fetch(url)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(html => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const products = extractProductsFromDocument(doc, fields);
        resolve({ products });
      })
      .catch(reject);
  });
}

function waitForDynamicContent(timeout = 5000) {
  return new Promise((resolve) => {
    if (document.querySelector('.product') || 
        document.querySelector('[class*="product"]') ||
        document.querySelector('script[type="application/ld+json"]')) {
      resolve();
      return;
    }
    
    const observer = new MutationObserver(() => {
      if (document.querySelector('.product') || 
          document.querySelector('[class*="product"]') ||
          document.querySelector('script[type="application/ld+json"]')) {
        observer.disconnect();
        resolve();
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, timeout);
  });
}

function detectTotalPages() {
  const selectors = [
    '.woocommerce-pagination .page-numbers:last-child:not(.next)',
    '.page-numbers.dots ~ .page-numbers:last-child',
    '.pagination .page-item:last-child .page-link'
  ];
  
  for (const selector of selectors) {
    const lastPageEl = document.querySelector(selector);
    if (lastPageEl) {
      const pageNum = parseInt(lastPageEl.textContent.trim());
      if (!isNaN(pageNum)) return pageNum;
    }
  }
  
  return 1;
}

function getNextPageUrl(pageNumber) {
  const currentUrl = new URL(window.location.href);
  
  if (currentUrl.searchParams.has('product-page')) {
    currentUrl.searchParams.set('product-page', pageNumber);
    return currentUrl.toString();
  }
  
  const pathParts = currentUrl.pathname.split('/');
  const pageRegex = /^page$/i;
  const pageNumRegex = /^\d+$/;
  
  let pageSegmentIndex = -1;
  for (let i = 0; i < pathParts.length; i++) {
    if (pageRegex.test(pathParts[i]) && 
        i + 1 < pathParts.length && 
        pageNumRegex.test(pathParts[i + 1])) {
      pageSegmentIndex = i + 1;
      break;
    }
  }
  
  if (pageSegmentIndex !== -1) {
    pathParts[pageSegmentIndex] = pageNumber.toString();
  } else {
    if (pathParts[pathParts.length - 1] === '') {
      pathParts.splice(-1, 0, 'page', pageNumber.toString());
    } else {
      pathParts.push('page', pageNumber.toString(), '');
    }
  }
  
  currentUrl.pathname = pathParts.join('/');
  return currentUrl.toString();
}

function extractProductsFromPage(fields) {
  const products = [];
  
  if (document.querySelector('.product') && isSingleProductPage()) {
    const product = extractSingleProduct(fields);
    if (product) products.push(product);
    return { products };
  }
  
  const containers = getProductContainers();
  containers.forEach(container => {
    const product = extractFromContainer(container, fields);
    if (product) products.push(product);
  });
  
  if (products.length === 0) {
    const jsonProducts = extractFromJSONLD(fields);
    products.push(...jsonProducts);
  }
  
  return { products };
}

function extractProductsFromDocument(doc, fields) {
  const products = [];
  
  if (doc.querySelector('.product') && isSingleProductPage(doc)) {
    const product = extractSingleProduct(fields, doc);
    if (product) products.push(product);
    return products;
  }
  
  const containers = getProductContainers(doc);
  containers.forEach(container => {
    const product = extractFromContainer(container, fields, doc);
    if (product) products.push(product);
  });
  
  return products;
}

function isSingleProductPage(doc = document) {
  return doc.querySelector('.single-product') || 
         doc.querySelector('.product-type-simple') ||
         (doc.querySelector('.product') && !doc.querySelector('.products'));
}

function getProductContainers(doc = document) {
  return [
    ...doc.querySelectorAll('.product'),
    ...doc.querySelectorAll('.woocommerce-loop-product__link'),
    ...doc.querySelectorAll('[class*="product-item"]')
  ].filter(el => 
    el.querySelector('.price') || 
    el.querySelector('.add_to_cart_button') ||
    el.querySelector('h2, h3, h4')
  );
}

function extractSingleProduct(fields, doc = document) {
  const product = {};
  
  if (fields.includes('title')) {
    product.title = doc.querySelector('.product_title')?.textContent?.trim() || 
                    doc.querySelector('h1')?.textContent?.trim() || '';
  }
  
  if (fields.includes('description')) {
    product.description = doc.querySelector('.product-description')?.textContent?.trim() || 
                          doc.querySelector('[itemprop="description"]')?.textContent?.trim() || '';
  }
  
  if (fields.includes('price')) product.price = getPrice(doc);
  if (fields.includes('images')) product.images = getImages(doc);
  if (fields.includes('stock_status')) product.stock_status = getStockStatus(doc);
  if (fields.includes('sku')) product.sku = getSKU(doc);
  if (fields.includes('categories')) product.categories = getCategories(doc);
  if (fields.includes('url')) product.url = window.location.href;
  
  return Object.keys(product).length > 0 ? product : null;
}

function extractFromContainer(container, fields, doc = document) {
  const product = {};
  
  if (fields.includes('title')) {
    const titleEl = container.querySelector('.woocommerce-loop-product__title') || 
                    container.querySelector('h2, h3, h4');
    product.title = titleEl?.textContent?.trim() || '';
  }
  
  if (fields.includes('price')) product.price = getPrice(container);
  if (fields.includes('images')) product.images = getImages(container);
  if (fields.includes('url')) {
    product.url = container.tagName === 'A' ? container.href : 
                  container.querySelector('a')?.href || window.location.href;
  }
  
  return Object.keys(product).length > 0 ? product : null;
}

function extractFromJSONLD(fields, doc = document) {
  const products = [];
  const jsonScripts = doc.querySelectorAll('script[type="application/ld+json"]');
  
  jsonScripts.forEach(script => {
    try {
      const data = JSON.parse(script.textContent);
      const items = Array.isArray(data) ? data : [data];
      
      items.forEach(item => {
        if (item['@type'] === 'Product') {
          const product = {};
          if (fields.includes('title')) product.title = item.name || '';
          if (fields.includes('description')) product.description = item.description || '';
          if (fields.includes('price')) product.price = item.offers?.price || '';
          if (fields.includes('images')) {
            const images = item.image || [];
            product.images = Array.isArray(images) ? images : [images];
          }
          if (fields.includes('url')) product.url = item.url || window.location.href;
          if (fields.includes('sku')) product.sku = item.sku || '';
          
          if (Object.keys(product).length > 0) products.push(product);
        }
      });
    } catch (e) { /* Ignore invalid JSON */ }
  });
  
  return products;
}

function getPrice(container = document) {
  const selectors = ['.price ins .amount', '.price .amount', '.woocommerce-Price-amount'];
  for (const selector of selectors) {
    const el = container.querySelector(selector);
    if (el) return el.textContent.trim().replace(/[^\d.,]/g, '');
  }
  return '';
}

function getImages(container = document) {
  const selectors = ['.woocommerce-product-gallery__image img', '.product-image img'];
  for (const selector of selectors) {
    const imgs = container.querySelectorAll(selector);
    if (imgs.length) {
      return Array.from(imgs).map(img => img.src || img.dataset.src || '').filter(Boolean);
    }
  }
  return [];
}

function getStockStatus(container = document) {
  const el = container.querySelector('.stock.in-stock, .stock.out-of-stock, .availability');
  return el ? el.textContent.trim() : 'In stock';
}

function getSKU(container = document) {
  return container.querySelector('.sku')?.textContent?.trim() || '';
}

function getCategories(container = document) {
  const cats = container.querySelectorAll('.posted_in a, .product_meta a[rel="tag"]');
  return cats.length ? Array.from(cats).map(cat => cat.textContent.trim()) : [];
}

function convertToCSV(products, fields) {
  if (!products.length) return '';
  
  const headers = fields;
  const csvRows = [headers.join(',')];
  
  products.forEach(product => {
    const row = headers.map(header => {
      let value = product[header] || '';
      if (Array.isArray(value)) value = `"${value.join('|').replace(/"/g, '""')}"`;
      else if (typeof value === 'string') value = `"${value.replace(/"/g, '""')}"`;
      return value;
    }).join(',');
    csvRows.push(row);
  });
  
  return csvRows.join('\n');
}

async function convertToXLSX(products, fields) {
  let attempts = 0;
  while (!window.XLSX && attempts < 10) {
    await new Promise(resolve => setTimeout(resolve, 500));
    attempts++;
  }
  
  if (!window.XLSX) {
    throw new Error('SheetJS failed to load');
  }
  
  const worksheetData = products.map(product => {
    const row = {};
    fields.forEach(field => {
      let value = product[field] || '';
      if (Array.isArray(value)) value = value.join('|');
      row[field] = value;
    });
    return row;
  });
  
  const ws = XLSX.utils.json_to_sheet(worksheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
}