function mergeVolumeRows(rows, limit = 15) {
  if (new Set(rows.map(row => row.chapter)).size !== rows.length) throw Error('跨卷发现重复章节号');
  // Each volume exposes its latest page. Compare the global latest page;
  // older per-volume pages otherwise create artificial gaps after 15 rows.
  return [...rows].sort((a, b) => b.chapter - a.chapter).slice(0, limit);
}
function requireVolume(row, expected) {
  if (expected && row?.volumeName !== expected) throw Error('目标章分卷不符');
}
function isSubmissionRejection(value) {
  if (/番茄审核工作时间是7:00-24:00，夜间发文会卡在审核中状态/.test(value)
    && !/提交失败|发布失败|字数.*上限|超出每日|频繁/.test(value)) return false;
  return /限制|上限|失败|不能|无法|频繁|稍后|最多|已达/.test(value);
}
const MANAGE_VOLUME_SELECTOR = '.serial-select.flat-serial-select:not(.chapter-status-select):has(.byte-select-view-value)';
async function manageVolumeSelector(page) {
  const selector = page.locator(MANAGE_VOLUME_SELECTOR);
  if (await selector.count() !== 1 || !(await selector.isVisible())) throw Error('章节管理分卷选择器不唯一或不可见');
  return selector;
}
async function captureThenCommit(capture, commit) {
  await capture();
  await commit();
}
module.exports = { mergeVolumeRows, requireVolume, isSubmissionRejection, manageVolumeSelector, MANAGE_VOLUME_SELECTOR, captureThenCommit };
