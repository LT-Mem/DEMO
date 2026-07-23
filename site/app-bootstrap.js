const loader = document.getElementById("loader");

import("./app.js?v=46").catch(async (error) => {
  console.warn("Interactive 3D is unavailable; using the compatible map.", error);
  document.querySelector("#viewer canvas")?.remove();
  if (loader) {
    loader.querySelector("strong").textContent = "Opening compatible map";
    loader.querySelector("small").textContent = "This browser could not start interactive 3D.";
  }
  await import("./app-static.js?v=46");
});
