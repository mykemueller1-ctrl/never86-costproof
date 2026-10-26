// Download only the visible, current run. No service or recipient receives this file.
for (const button of document.querySelectorAll('[data-download-target]')) {
  button.addEventListener('click', () => {
    const source = document.getElementById(button.dataset.downloadTarget);
    if (!source || source.closest('[hidden]') || !source.textContent.trim()) return;
    let receipt;
    try { receipt = JSON.parse(source.textContent); } catch { return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    const id = typeof receipt.run_id === 'string' ? receipt.run_id.replace(/[^a-zA-Z0-9_-]/g, '') : 'preview';
    link.download = 'costproof-' + button.dataset.workflow + '-' + id + '.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
