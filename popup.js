const button = document.getElementById("open-options");

button.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
