/**
 * External, same-origin browser script for the Control Center shell.
 * Served at /workspace-ui.js so CSP can remain script-src 'self' without
 * allowing inline handlers or unsafe-inline. No privileged data is embedded.
 */
export const workspaceUiScript = String.raw`
(() => {
  "use strict";

  const sidebar = document.getElementById("ws-side");
  const menu = document.querySelector(".ws-menu");
  const search = document.querySelector(".ws-search");
  const searchStatus = document.getElementById("ws-search-status");
  const links = Array.from(document.querySelectorAll(".ws-link"));
  const groups = Array.from(document.querySelectorAll(".ws-group"));
  const isMobile = () => window.matchMedia("(max-width: 850px)").matches;

  if (!sidebar || !menu) return;

  function setMenuOpen(open) {
    sidebar.classList.toggle("ws-open", open);
    menu.setAttribute("aria-expanded", String(open));
  }

  links.forEach(link => {
    if (link.getAttribute("href") === window.location.pathname) {
      link.setAttribute("aria-current", "page");
    }
  });

  menu.addEventListener("click", () => {
    setMenuOpen(!sidebar.classList.contains("ws-open"));
  });

  if (search) {
    search.addEventListener("input", () => {
      const query = search.value.trim().toLocaleLowerCase();
      let visibleCount = 0;

      links.forEach(link => {
        link.hidden = !(link.textContent || "").toLocaleLowerCase().includes(query);
        if (!link.hidden) visibleCount++;
      });

      groups.forEach(group => {
        group.hidden = !Array.from(group.querySelectorAll(".ws-link"))
          .some(link => !link.hidden);
      });

      if (searchStatus) {
        searchStatus.textContent = query
          ? (visibleCount ? visibleCount + " módulos encontrados" : "No se encontraron módulos")
          : "";
      }

      if (query && isMobile()) setMenuOpen(true);
    });
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && sidebar.classList.contains("ws-open")) {
      setMenuOpen(false);
      menu.focus();
    }
  });

  window.addEventListener("resize", () => {
    if (!isMobile()) setMenuOpen(false);
  });
})();
`;
