const copyButtons = document.querySelectorAll("[data-copy-link]");
const linkButtons = document.querySelectorAll("[data-site-link]");
const copyNameButton = document.getElementById("copy-name-button");
const copyLinkValue = document.getElementById("copy-link-value");
const copyToast = document.getElementById("copy-toast");
const miniProgramName = document.getElementById("entry-title").textContent.trim();
const siteLinks = window.SITE_LINKS;
const shortLink = siteLinks.miniProgramShortLink;
let toastTimer;

copyLinkValue.textContent = shortLink;

linkButtons.forEach((element) => {
  const href = siteLinks[element.dataset.siteLink];
  if (href) element.href = href;
});

const showToast = (message, type = "success") => {
  clearTimeout(toastTimer);
  copyToast.textContent = message;
  copyToast.classList.toggle("copy-toast--error", type === "error");
  copyToast.classList.add("is-visible");
  toastTimer = setTimeout(() => {
    copyToast.classList.remove("is-visible");
  }, 1800);
};

const copyShortLink = async () => {
  copyButtons.forEach((button) => {
    button.disabled = true;
  });

  try {
    await navigator.clipboard.writeText(shortLink);
    showToast("链接已复制");
  } catch (error) {
    showToast("复制失败，请手动复制", "error");
  } finally {
    copyButtons.forEach((button) => {
      button.disabled = false;
    });
  }
};

copyButtons.forEach((button) => {
  button.addEventListener("click", copyShortLink);
});

copyNameButton.addEventListener("click", async () => {
  copyNameButton.disabled = true;

  try {
    await navigator.clipboard.writeText(miniProgramName);
    showToast("名称已复制");
  } catch (error) {
    showToast("复制失败，请手动复制", "error");
  } finally {
    copyNameButton.disabled = false;
  }
});
