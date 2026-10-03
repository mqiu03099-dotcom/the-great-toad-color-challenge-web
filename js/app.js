const copyButtons = document.querySelectorAll("[data-copy-link]");
const copyLinkValue = document.getElementById("copy-link-value");
const copyStatus = document.getElementById("copy-status");
const shortLink = window.MINI_PROGRAM_SHORT_LINK;

copyLinkValue.textContent = shortLink;

const copyShortLink = async () => {
  copyButtons.forEach((button) => {
    button.disabled = true;
  });

  try {
    await navigator.clipboard.writeText(shortLink);
    copyStatus.textContent = "已复制，打开微信粘贴即可进入";
  } catch (error) {
    copyStatus.textContent = "复制失败，请长按上方链接手动复制";
  } finally {
    copyButtons.forEach((button) => {
      button.disabled = false;
    });
  }
};

copyButtons.forEach((button) => {
  button.addEventListener("click", copyShortLink);
});
