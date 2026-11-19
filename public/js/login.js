(() => {
  const form = document.querySelector('#loginForm');
  const message = document.querySelector('#loginMessage');
  const submit = form.querySelector('button[type="submit"]');
  const password = document.querySelector('#password');
  const toggle = document.querySelector('.password-toggle');
  const tokenKey = 'uibakery.accessToken';
  const refreshKey = 'uibakery.refreshToken';

  const showMessage = (text) => { message.textContent = text || ''; };

  toggle.addEventListener('click', () => {
    const visible = password.type === 'text';
    password.type = visible ? 'password' : 'text';
    toggle.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
    toggle.innerHTML = `<i class="bi ${visible ? 'bi-eye' : 'bi-eye-slash'}"></i>`;
  });

  document.querySelectorAll('.demo-fill').forEach((btn) => {
    btn.addEventListener('click', () => {
      form.email.value = btn.dataset.email || '';
      form.password.value = btn.dataset.password || '';
      if (!btn.dataset.password) {
        form.password.focus();
        showMessage('Enter your administrator password');
      } else {
        showMessage('');
      }
    });
  });

  const existingToken = localStorage.getItem(tokenKey);
  if (existingToken) {
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${existingToken}` } })
      .then((response) => { if (response.ok) window.location.replace('/app'); })
      .catch(() => {});
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('');
    if (!form.reportValidity()) return;
    submit.disabled = true;
    submit.querySelector('span').textContent = 'Signing in…';
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.value.trim(), password: form.password.value }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not sign in. Try again.');
      localStorage.setItem(tokenKey, result.access_token);
      if (result.refresh_token) localStorage.setItem(refreshKey, result.refresh_token);
      window.location.replace('/app');
    } catch (error) {
      showMessage(error.message);
      submit.disabled = false;
      submit.querySelector('span').textContent = 'Sign in to workspace';
    }
  });
})();
