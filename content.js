(function () {
  const products = [];

  document.querySelectorAll(".product").forEach(product => {
    const title =
      product.querySelector(".woocommerce-loop-product__title")?.innerText || "";

    const price =
      product.querySelector(".price")?.innerText.replace(/\s+/g, " ") || "";

    const image =
      product.querySelector("img")?.src || "";

    const link =
      product.querySelector("a")?.href || "";

    products.push({
      title,
      price,
      image,
      link,
      source: location.hostname
    });
  });

  chrome.runtime.sendMessage({
    type: "SCRAPED_DATA",
    data: products
  });
})();
