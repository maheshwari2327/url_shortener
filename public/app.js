/**
 * ============================================================================
 * LAYER: Frontend / Client Script Layer (Vanilla JavaScript)
 * Description: Handles DOM interactions, form submission, asynchronous API
 *              calls (POST /api/shorten, GET /api/recent, GET /api/status),
 *              clipboard copy operations, dynamic table rendering, and toast alerts.
 * ============================================================================
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements - Form & Inputs
  const shortenForm = document.getElementById('shortenForm');
  const longUrlInput = document.getElementById('longUrlInput');
  const customCodeInput = document.getElementById('customCodeInput');
  const expirySelect = document.getElementById('expirySelect');
  const submitBtn = document.getElementById('submitBtn');
  const btnText = document.getElementById('btnText');
  const btnSpinner = document.getElementById('btnSpinner');
  const alertBox = document.getElementById('alertBox');

  // DOM Elements - Result Card
  const resultCard = document.getElementById('resultCard');
  const shortResultInput = document.getElementById('shortResultInput');
  const copyResultBtn = document.getElementById('copyResultBtn');
  const copyBtnLabel = document.getElementById('copyBtnLabel');
  const visitResultBtn = document.getElementById('visitResultBtn');
  const originalUrlDisplay = document.getElementById('originalUrlDisplay');
  const resultExpiryBadge = document.getElementById('resultExpiryBadge');

  // DOM Elements - Recent Links Table
  const recentTableBody = document.getElementById('recentTableBody');
  const recentCountBadge = document.getElementById('recentCountBadge');
  const refreshTableBtn = document.getElementById('refreshTableBtn');
  const refreshIcon = document.getElementById('refreshIcon');
  const emptyState = document.getElementById('emptyState');

  // DOM Elements - Status & Toast
  const redisStatusBadge = document.getElementById('redisStatusBadge');
  const redisStatusText = document.getElementById('redisStatusText');
  const toastEl = document.getElementById('liveToast');
  const toastMessage = document.getElementById('toastMessage');
  const toastIcon = document.getElementById('toastIcon');

  // Bootstrap Toast instance
  const toast = new bootstrap.Toast(toastEl, { delay: 2500 });

  /**
   * Helper: Displays a notification toast to the user
   */
  function showToast(message, isSuccess = true) {
    toastMessage.textContent = message;
    if (isSuccess) {
      toastIcon.className = 'bi bi-check-circle-fill text-success fs-5';
    } else {
      toastIcon.className = 'bi bi-exclamation-circle-fill text-danger fs-5';
    }
    toast.show();
  }

  /**
   * Helper: Displays or hides top alert banner
   */
  function showAlert(message, type = 'danger') {
    alertBox.className = `alert alert-${type} mb-4 py-2.5 px-3 rounded-3 d-flex align-items-center gap-2`;
    alertBox.innerHTML = `
      <i class="bi ${type === 'danger' ? 'bi-exclamation-triangle-fill' : 'bi-info-circle-fill'}"></i>
      <div>${message}</div>
    `;
    alertBox.classList.remove('d-none');
  }

  function hideAlert() {
    alertBox.classList.add('d-none');
    alertBox.innerHTML = '';
  }

  /**
   * Helper: Copies text to the system clipboard with fallback support
   */
  async function copyToClipboard(text, triggerButton = null, originalLabel = 'Copy') {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-https / older browsers
        const tempInput = document.createElement('input');
        tempInput.value = text;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
      }

      showToast('Short URL copied to clipboard!', true);

      // Provide temporary button feedback if trigger button provided
      if (triggerButton) {
        const icon = triggerButton.querySelector('i');
        const textSpan = triggerButton.querySelector('span');

        if (icon) icon.className = 'bi bi-check2';
        if (textSpan) textSpan.textContent = 'Copied!';

        setTimeout(() => {
          if (icon) icon.className = 'bi bi-copy';
          if (textSpan) textSpan.textContent = originalLabel;
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      showToast('Could not copy to clipboard. Please copy manually.', false);
    }
  }

  /**
   * Helper: Formats remaining TTL seconds into a friendly human-readable string
   */
  function formatTTL(seconds) {
    if (!seconds || seconds <= 0) return 'Permanent';
    if (seconds < 60) return `${seconds}s left`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m left`;
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    if (hours < 24) return `${hours}h ${remMinutes}m left`;
    const days = Math.floor(hours / 24);
    return `${days}d left`;
  }

  /**
   * Helper: Formats ISO timestamp into relative or short readable date
   */
  function formatDate(isoString) {
    if (!isoString) return 'Recently';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch (_) {
      return 'Recently';
    }
  }

  /**
   * Fetches the current Redis server status and updates the navigation badge
   */
  async function checkServerStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();

      if (data.redisConnected) {
        redisStatusBadge.className = 'badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 px-3 py-1.5 rounded-pill d-flex align-items-center gap-2';
        redisStatusBadge.innerHTML = `
          <span class="rounded-circle bg-success" style="width: 8px; height: 8px; display: inline-block;"></span>
          <span class="small fw-semibold">Redis Connected</span>
        `;
        redisStatusBadge.title = 'Connected to official Redis service on port 6379';
      } else {
        redisStatusBadge.className = 'badge bg-warning bg-opacity-10 text-warning border border-warning border-opacity-25 px-3 py-1.5 rounded-pill d-flex align-items-center gap-2';
        redisStatusBadge.innerHTML = `
          <span class="rounded-circle bg-warning" style="width: 8px; height: 8px; display: inline-block;"></span>
          <span class="small fw-semibold">Demo Store (Ready for Docker Redis)</span>
        `;
        redisStatusBadge.title = 'Redis offline. Run: docker run -p 6379:6379 redis for persistent storage.';
      }
    } catch (err) {
      console.warn('Could not query /api/status:', err);
    }
  }

  /**
   * Fetches the recent links from GET /api/recent and updates the table
   */
  async function loadRecentLinks() {
    try {
      refreshIcon.classList.add('spin-animation');

      const response = await fetch('/api/recent');
      if (!response.ok) {
        throw new Error(`Failed to load recent links (${response.status})`);
      }

      const data = await response.json();
      const links = data.links || [];

      // Update badge count
      recentCountBadge.textContent = `${links.length} ${links.length === 1 ? 'link' : 'links'}`;

      if (links.length === 0) {
        recentTableBody.innerHTML = '';
        emptyState.classList.remove('d-none');
        return;
      }

      emptyState.classList.add('d-none');

      // Build table rows
      recentTableBody.innerHTML = links.map((item) => {
        const shortUrl = item.short;
        const code = item.code;
        const clicks = item.clicks || 0;
        const original = item.originalUrl;
        const ttlLabel = item.ttl ? formatTTL(item.ttl) : 'Permanent';
        const dateLabel = formatDate(item.createdAt);

        return `
          <tr>
            <td>
              <div class="d-flex align-items-center gap-2">
                <a href="${shortUrl}" target="_blank" class="fw-bold text-info text-decoration-none">
                  /${code}
                </a>
                ${item.isCustom ? '<span class="badge bg-secondary bg-opacity-50 text-white-50" style="font-size: 0.65rem;">custom</span>' : ''}
              </div>
              <div class="text-secondary small font-monospace" style="font-size: 0.75rem;">${shortUrl}</div>
            </td>
            <td>
              <div class="url-cell" title="${original}">
                <a href="${original}" target="_blank" class="text-decoration-none text-light opacity-75">
                  ${original}
                </a>
              </div>
              <div class="text-secondary small" style="font-size: 0.72rem;">Created: ${dateLabel}</div>
            </td>
            <td class="text-center">
              <span class="badge-clicks" title="Total times this link was visited (HTTP 302)">
                <i class="bi bi-graph-up-arrow me-1"></i>${clicks}
              </span>
            </td>
            <td>
              ${item.ttl ? `
                <span class="badge-ttl">
                  <i class="bi bi-clock me-1"></i>${ttlLabel}
                </span>
              ` : `
                <span class="badge bg-dark border border-secondary border-opacity-50 text-white-50 small rounded-pill px-2.5 py-1">
                  <i class="bi bi-infinity me-1"></i>Never
                </span>
              `}
            </td>
            <td class="text-end">
              <div class="btn-group btn-group-sm">
                <!-- Direct Visit Button (Tests redirect & triggers INCR) -->
                <a 
                  href="${shortUrl}" 
                  target="_blank" 
                  class="btn btn-copy-sm" 
                  title="Visit short link (HTTP 302)"
                  onclick="setTimeout(loadRecentLinks, 800)"
                >
                  <i class="bi bi-box-arrow-up-right"></i>
                </a>
                <!-- Copy Button -->
                <button 
                  type="button" 
                  class="btn btn-copy-sm copy-row-btn" 
                  data-url="${shortUrl}" 
                  title="Copy short link"
                >
                  <i class="bi bi-copy"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      // Attach click listeners to row copy buttons
      document.querySelectorAll('.copy-row-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const url = btn.getAttribute('data-url');
          copyToClipboard(url, btn);
        });
      });

    } catch (err) {
      console.error('Error fetching recent links:', err);
      recentTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center py-3 text-danger">
            <i class="bi bi-exclamation-triangle me-1"></i> Error loading links: ${err.message}
          </td>
        </tr>
      `;
    } finally {
      setTimeout(() => {
        refreshIcon.classList.remove('spin-animation');
      }, 400);
    }
  }

  /**
   * Handles Form Submission: POST /api/shorten
   */
  shortenForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    const longUrl = longUrlInput.value.trim();
    const customCode = customCodeInput.value.trim();
    const expirySeconds = expirySelect.value ? parseInt(expirySelect.value, 10) : null;

    // Basic frontend URL validation
    if (!longUrl) {
      showAlert('Please enter a destination URL to shorten.');
      longUrlInput.focus();
      return;
    }

    if (!longUrl.startsWith('http://') && !longUrl.startsWith('https://')) {
      showAlert('The URL must begin with http:// or https://');
      longUrlInput.focus();
      return;
    }

    // Set UI to loading state
    submitBtn.disabled = true;
    btnText.classList.add('d-none');
    btnSpinner.classList.remove('d-none');

    try {
      const response = await fetch('/api/shorten', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: longUrl,
          customCode: customCode || undefined,
          expirySeconds: expirySeconds || undefined
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to shorten URL');
      }

      // Successful creation (201 Created)
      shortResultInput.value = data.short;
      visitResultBtn.href = data.short;
      originalUrlDisplay.href = data.originalUrl;
      originalUrlDisplay.textContent = data.originalUrl;

      if (data.expiresIn) {
        resultExpiryBadge.textContent = `Expires in ${formatTTL(data.expiresIn)}`;
      } else {
        resultExpiryBadge.textContent = 'Permanent link';
      }

      // Display the result card with animation
      resultCard.classList.remove('d-none');
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // Provide notification
      showToast('🎉 Short URL created successfully!', true);

      // Reset form fields
      customCodeInput.value = '';
      expirySelect.value = '';

      // Immediately refresh the Recent Links table to show new link at the top
      await loadRecentLinks();

    } catch (err) {
      console.error('Shorten error:', err);
      showAlert(err.message || 'An error occurred while shortening the URL.');
    } finally {
      // Re-enable submit button
      submitBtn.disabled = false;
      btnText.classList.remove('d-none');
      btnSpinner.classList.add('d-none');
    }
  });

  /**
   * Copy button on the main result card
   */
  copyResultBtn.addEventListener('click', () => {
    const shortUrl = shortResultInput.value;
    if (shortUrl) {
      copyToClipboard(shortUrl, copyResultBtn, 'Copy Link');
    }
  });

  /**
   * When user clicks on the result input box, select all text for easy manual copying
   */
  shortResultInput.addEventListener('click', () => {
    shortResultInput.select();
  });

  /**
   * Manual refresh button for the recent links table
   */
  refreshTableBtn.addEventListener('click', () => {
    loadRecentLinks();
    checkServerStatus();
  });

  // Initial Load: check status and load seeded recent links
  checkServerStatus();
  loadRecentLinks();
});
