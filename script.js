/* ============================================================
   SETTINGS
   ============================================================ */

/* The class Cloudflare Worker URL (it holds the OpenAI key for us).
   👉 Replace this with the Worker URL your instructor gives you.
   NEVER put an API key in this file — it is public! */
const WORKER_URL = "https://mute-river-9f61.tamangkaushal87.workers.dev/";

/* The key name we use to save selected products in localStorage */
const STORAGE_KEY = "lorealSelectedProductIds";

/* The key name we use to remember the page direction ("ltr" or "rtl") */
const DIRECTION_KEY = "lorealPageDirection";

/* ============================================================
   GET REFERENCES TO DOM ELEMENTS
   ============================================================ */
const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const rtlToggle = document.getElementById("rtlToggle");
const rtlLabel = document.getElementById("rtlLabel");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const selectedCount = document.getElementById("selectedCount");
const clearAllBtn = document.getElementById("clearAll");
const generateBtn = document.getElementById("generateRoutine");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const userInput = document.getElementById("userInput");

/* ============================================================
   APP STATE (data the app remembers while it runs)
   ============================================================ */

/* Every product from products.json (filled in when the page loads) */
let allProducts = [];

/* The ids of the products the user has selected.
   We load any saved ids from localStorage so they survive a page reload. */
let selectedIds = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];

/* The full conversation we send to OpenAI on every request.
   It starts with a "system" message that tells the AI how to behave. */
const messages = [
  {
    role: "system",
    content: `You are a friendly, expert L'Oréal beauty advisor.
You build personalized routines using the products the user has selected.
ONLY answer questions about the user's routine or about skincare, haircare,
makeup, fragrance, and related beauty topics. If the user asks about
anything else (sports, news, politics, math, coding, and so on), do NOT answer
it and do NOT share web results about it, even if you found some. Just say
that you can only help with beauty topics.
Keep answers clear and well organized, using short steps (Morning / Evening
when it makes sense). Use short headings and lists. Never use tables
or "---" lines.
Use web search to find current information about L'Oréal products and
routines, and include links to your sources.
Reply in the same language the user writes in.`,
  },
];

/* Our Cloudflare Worker URL.
   The Worker holds the OpenAI API key safely, so we never put a key here. */
const workerUrl = "https://mute-river-9f61.tamangkaushal87.workers.dev/";

/* A short reminder added to the end of every request. The search model always
   searches the web, so this helps it remember to stay on topic. */
const topicReminder = {
  role: "system",
  content: `Before replying, check the user's latest message. If it is not about
beauty or their routine, refuse politely in one sentence and do not answer it.
If it is about beauty, answer normally. Only recommend products from brands
owned by L'Oréal Group (such as L'Oréal Paris, CeraVe, Garnier, Lancôme,
La Roche-Posay, Vichy, Maybelline, Kérastase, and Redken). Never recommend a
competitor brand. Do not use tables.`,
};

/* ============================================================
   LOADING AND SHOWING PRODUCTS
   ============================================================ */

/* Load product data from the JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
}

/* Find a product object by its id */
function findProduct(id) {
  return allProducts.find((product) => product.id === id);
}

/* Create the HTML for the product cards in the grid */
function displayProducts(products) {
  /* If no products match, show a friendly message */
  if (products.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">No products match your search.</div>
    `;
    return;
  }

  productsContainer.innerHTML = products
    .map((product) => {
      /* Check if this product is already selected */
      const isSelected = selectedIds.includes(product.id);

      return `
        <div class="product-card ${isSelected ? "selected" : ""}"
             data-id="${product.id}"
             tabindex="0"
             role="button"
             aria-pressed="${isSelected}"
             aria-label="${isSelected ? "Unselect" : "Select"} ${product.name}">
          <span class="check-mark" aria-hidden="true">
            <i class="fa-solid fa-check"></i>
          </span>
          <img src="${product.image}" alt="${product.name}">
          <div class="product-info">
            <p class="brand">${product.brand}</p>
            <h3>${product.name}</h3>
            <button class="details-btn" type="button" aria-expanded="false"
                    aria-controls="desc-${product.id}">
              <i class="fa-solid fa-circle-info"></i> Details
            </button>
          </div>
          <p class="product-description" id="desc-${product.id}" hidden>
            ${product.description}
          </p>
        </div>
      `;
    })
    .join("");
}

/* Make text easier to compare: lowercase, with accents removed.
   This lets "lancome" find "Lancôme". */
function simplifyText(text) {
  return text
    .toLowerCase()
    .normalize("NFD") // split "ô" into "o" + accent
    .replace(/[\u0300-\u036f]/g, ""); // delete the accents
}

/* Check if a product contains every word the user typed */
function matchesSearch(product, searchText) {
  /* Put all the searchable text for this product in one string */
  const productText = simplifyText(
    `${product.name} ${product.brand} ${product.category} ${product.description}`,
  );

  /* Split the search into words, e.g. "dry skin" → ["dry", "skin"] */
  const words = searchText.split(" ");
  return words.every((word) => productText.includes(word));
}

/* Show the products that match BOTH the category and the search box */
function refreshProductGrid() {
  const selectedCategory = categoryFilter.value;
  const searchText = simplifyText(productSearch.value.trim());

  /* Nothing chosen and nothing typed yet — show the placeholder */
  if (!selectedCategory && !searchText) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        Select a category or search to view products
      </div>
    `;
    return;
  }

  /* filter() creates a new array containing only products
     that pass both checks */
  const filteredProducts = allProducts.filter((product) => {
    /* No category yet (or "All Categories") means every category is OK */
    const categoryMatches =
      !selectedCategory ||
      selectedCategory === "all" ||
      product.category === selectedCategory;

    return categoryMatches && matchesSearch(product, searchText);
  });

  displayProducts(filteredProducts);
}

/* ============================================================
   SELECTING PRODUCTS
   ============================================================ */

/* Save the selected ids to localStorage so they stay after a reload */
function saveSelections() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedIds));
}

/* Add a product if it isn't selected, or remove it if it is */
function toggleProduct(id) {
  if (selectedIds.includes(id)) {
    /* Keep every id except the one we're removing */
    selectedIds = selectedIds.filter((selectedId) => selectedId !== id);
  } else {
    selectedIds.push(id);
  }

  saveSelections();
  refreshProductGrid();
  renderSelectedProducts();
}

/* Show the "Selected Products" list */
function renderSelectedProducts() {
  /* Update the little number badge */
  selectedCount.textContent = selectedIds.length;

  /* Only show the "Clear all" button when there is something to clear */
  clearAllBtn.hidden = selectedIds.length === 0;

  if (selectedIds.length === 0) {
    selectedProductsList.innerHTML = `
      <p class="empty-message">No products selected yet. Click a product card to add it.</p>
    `;
    return;
  }

  selectedProductsList.innerHTML = selectedIds
    .map((id) => {
      const product = findProduct(id);

      /* Skip ids that no longer exist in products.json */
      if (!product) return "";

      return `
        <div class="selected-item">
          <img src="${product.image}" alt="">
          <span>${product.name}</span>
          <button class="remove-btn" type="button" data-id="${product.id}"
                  aria-label="Remove ${product.name}">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      `;
    })
    .join("");
}

/* ============================================================
   CHAT WINDOW HELPERS
   ============================================================ */

/* Make text safe to put inside HTML (so the AI can't inject tags) */
function escapeHTML(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/* Turn simple Markdown from the AI (**bold**, ### headings, links, line breaks)
   into HTML so the routine is easy to read */
function formatReply(text) {
  return escapeHTML(text)
    .replace(/\n*^---+\s*$\n*/gm, "\n\n") // remove "---" divider lines
    .replace(/^#{1,6}\s*(.+)$/gm, "<strong>$1</strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    /* [text](https://...) becomes a clickable link that opens in a new tab */
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)"]+)\)/g,
      `<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>`,
    )
    .replace(/\n/g, "<br>");
}

/* Add a message bubble to the chat window.
   "sender" is either "user" or "ai". Returns the new bubble element. */
function addMessage(sender, html) {
  const bubble = document.createElement("div");
  bubble.className = `msg ${sender}`;
  bubble.innerHTML = html;
  chatWindow.appendChild(bubble);

  /* Scroll to the newest message */
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return bubble;
}

/* Show the web pages the AI used, as a list of links under its answer.
   OpenAI sends them in an "annotations" array. */
function addSources(bubble, annotations) {
  /* A Set remembers which links we already added, so there are no repeats */
  const usedUrls = new Set();
  const list = document.createElement("ul");

  annotations.forEach((annotation) => {
    /* Skip anything that isn't a web link */
    if (annotation.type !== "url_citation") return;
    const { url, title } = annotation.url_citation;
    if (!/^https?:\/\//.test(url) || usedUrls.has(url)) return;
    usedUrls.add(url);

    /* Build one link. textContent keeps the title safe (no HTML runs) */
    const link = document.createElement("a");
    link.href = url;
    link.textContent = title || url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const item = document.createElement("li");
    item.appendChild(link);
    list.appendChild(item);
  });

  /* No links? Then don't show a "Sources" box */
  if (usedUrls.size === 0) return;

  const sources = document.createElement("div");
  sources.className = "sources";
  sources.innerHTML = "<strong>Sources</strong>";
  sources.appendChild(list);
  bubble.appendChild(sources);
}

/* ============================================================
   TALKING TO OPENAI (through the Cloudflare Worker)
   ============================================================ */

/* Send the whole conversation to the Worker and show the AI's reply */
async function getAIReply() {
  /* Show a "thinking" bubble while we wait */
  const loadingBubble = addMessage(
    "ai loading",
    `<i class="fa-solid fa-spinner fa-spin"></i> Thinking…`,
  );

  /* Disable buttons so the user can't send twice at once */
  generateBtn.disabled = true;
  chatForm.querySelector("button").disabled = true;

  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5-search-api", // a model that can search the web
        web_search_options: {}, // turn on web search (default settings)
        /* the FULL history (so the AI remembers context) + the reminder */
        messages: [...messages, topicReminder],
      }),
    });

    const data = await response.json();
    const reply = data.choices[0].message.content;

    /* Links the AI found on the web (an empty list if there are none) */
    const annotations = data.choices[0].message.annotations || [];

    /* Remember the AI's reply in the conversation history */
    messages.push({ role: "assistant", content: reply });

    /* Replace the loading bubble with the real answer */
    loadingBubble.classList.remove("loading");
    loadingBubble.innerHTML = formatReply(reply);
    addSources(loadingBubble, annotations);
  } catch (error) {
    console.error(error);
    loadingBubble.classList.remove("loading");
    loadingBubble.innerHTML =
      "Sorry, something went wrong reaching the advisor. Please try again.";
  } finally {
    /* Turn the buttons back on */
    generateBtn.disabled = false;
    chatForm.querySelector("button").disabled = false;
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
}

/* ============================================================
   EVENT LISTENERS
   ============================================================ */

/* When the category changes, show that category's products */
categoryFilter.addEventListener("change", refreshProductGrid);

/* Every time the user types in the search box, update the grid */
productSearch.addEventListener("input", refreshProductGrid);

/* Set the page direction to "ltr" or "rtl" and update the button */
function setDirection(direction) {
  const isRTL = direction === "rtl";

  /* dir on the <html> element flips the whole layout */
  document.documentElement.dir = direction;
  rtlToggle.setAttribute("aria-pressed", isRTL);
  rtlLabel.textContent = isRTL ? "Switch to LTR" : "Switch to RTL";

  /* Remember the choice for next time */
  localStorage.setItem(DIRECTION_KEY, direction);
}

/* The RTL button switches to the opposite direction */
rtlToggle.addEventListener("click", () => {
  const isRTL = document.documentElement.dir === "rtl";
  setDirection(isRTL ? "ltr" : "rtl");
});

/* Clicks inside the product grid */
productsContainer.addEventListener("click", (e) => {
  const card = e.target.closest(".product-card");
  if (!card) return;

  /* If the "Details" button was clicked, show/hide the description
     instead of selecting the product */
  const detailsBtn = e.target.closest(".details-btn");
  if (detailsBtn) {
    const description = card.querySelector(".product-description");
    const isOpen = !description.hidden;
    description.hidden = isOpen;
    detailsBtn.setAttribute("aria-expanded", !isOpen);
    detailsBtn.innerHTML = isOpen
      ? `<i class="fa-solid fa-circle-info"></i> Details`
      : `<i class="fa-solid fa-chevron-up"></i> Hide`;
    return;
  }

  /* Otherwise, select or unselect the product */
  toggleProduct(Number(card.dataset.id));
});

/* Let keyboard users select a card with Enter or Space */
productsContainer.addEventListener("keydown", (e) => {
  const isCard = e.target.classList.contains("product-card");
  if (isCard && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault(); // stop Space from scrolling the page
    toggleProduct(Number(e.target.dataset.id));

    /* The grid re-renders, so put focus back on the same card */
    productsContainer
      .querySelector(`.product-card[data-id="${e.target.dataset.id}"]`)
      .focus();
  }
});

/* Remove a single product from the Selected Products list */
selectedProductsList.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".remove-btn");
  if (removeBtn) {
    toggleProduct(Number(removeBtn.dataset.id));
  }
});

/* Clear every selected product at once */
clearAllBtn.addEventListener("click", () => {
  selectedIds = [];
  saveSelections();
  refreshProductGrid();
  renderSelectedProducts();
});

/* "Generate Routine" button */
generateBtn.addEventListener("click", async () => {
  /* Make sure the user picked at least one product */
  if (selectedIds.length === 0) {
    addMessage("ai", "Please select at least one product to build your routine. ✨");
    return;
  }

  /* Collect ONLY the selected products, with just the fields the AI needs */
  const selectedProducts = selectedIds
    .map((id) => findProduct(id))
    .filter((product) => product) // remove any missing products
    .map((product) => ({
      name: product.name,
      brand: product.brand,
      category: product.category,
      description: product.description,
    }));

  /* Add the request to the conversation history */
  messages.push({
    role: "user",
    content: `Build a personalized routine using these products:\n${JSON.stringify(
      selectedProducts,
      null,
      2,
    )}`,
  });

  /* Show a short, friendly version of the request in the chat */
  addMessage(
    "user",
    `Build my routine with: ${selectedProducts
      .map((product) => escapeHTML(product.name))
      .join(", ")}`,
  );

  await getAIReply();
});

/* Follow-up questions from the chat box */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const question = userInput.value.trim();
  if (!question) return;

  /* Show the question and add it to the conversation history */
  addMessage("user", escapeHTML(question));
  messages.push({ role: "user", content: question });
  userInput.value = "";

  await getAIReply();
});

/* ============================================================
   START THE APP
   ============================================================ */
async function init() {
  /* Use the saved page direction, or left-to-right the first time */
  setDirection(localStorage.getItem(DIRECTION_KEY) || "ltr");

  allProducts = await loadProducts();

  /* Remove saved ids for products that no longer exist */
  selectedIds = selectedIds.filter((id) => findProduct(id));

  refreshProductGrid();
  renderSelectedProducts();

  /* Welcome message in the chat */
  addMessage(
    "ai",
    "Hi! 👋 Pick some products above, then click <strong>Generate Routine</strong> and I'll build a routine just for you.",
  );
}

init();
