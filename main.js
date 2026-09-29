const menuToggle = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#primary-navigation');

function setMenuOpen(isOpen) {
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
  navigation.classList.toggle('is-open', isOpen);
}

menuToggle.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  setMenuOpen(!isOpen);
});

navigation.addEventListener('click', event => {
  if (event.target.closest('a')) setMenuOpen(false);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') {
    setMenuOpen(false);
    menuToggle.focus();
  }
});

document.querySelector('#year').textContent = new Date().getFullYear();

for (const tabGroup of document.querySelectorAll('[data-tab-group]')) {
  const tabs = [...tabGroup.querySelectorAll('[role="tab"]')];

  function activateTab(tab, moveFocus = false) {
    for (const candidate of tabs) {
      const isSelected = candidate === tab;
      candidate.setAttribute('aria-selected', String(isSelected));
      candidate.tabIndex = isSelected ? 0 : -1;
      document.getElementById(candidate.getAttribute('aria-controls')).hidden = !isSelected;
    }

    if (moveFocus) tab.focus();
  }

  tabGroup.addEventListener('click', event => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) activateTab(tab);
  });

  tabGroup.addEventListener('keydown', event => {
    const tab = event.target.closest('[role="tab"]');
    if (!tab) return;

    const currentIndex = tabs.indexOf(tab);
    let nextIndex;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    activateTab(tabs[nextIndex], true);
  });
}

const contactForm = document.querySelector('#contact-form');
const contactFormStatus = document.querySelector('#contact-form-status');

contactForm.addEventListener('submit', event => {
  event.preventDefault();

  if (!contactForm.reportValidity()) return;

  const values = new FormData(contactForm);
  const body = [
    `Name: ${values.get('name')}`,
    `Email: ${values.get('email')}`,
    `Phone: ${values.get('phone') || 'Not provided'}`,
    '',
    `Message: ${values.get('message')}`,
  ].join('\n');
  const query = new URLSearchParams({
    subject: 'Website contact request',
    body,
  });

  contactFormStatus.textContent = 'Your email application should open with a draft. If it does not, email hcr@hcrmaine.com directly.';
  window.location.href = `mailto:hcr@hcrmaine.com?${query.toString()}`;
});

const applicationForm = document.querySelector('#application-form');
const applicationStatus = document.querySelector('#application-status');
const attachmentInputs = document.querySelector('#attachment-inputs');
const addAttachmentButton = document.querySelector('#add-attachment');
const attachmentStatus = document.querySelector('#attachment-status');
const MAX_ATTACHMENTS = 3;

addAttachmentButton.addEventListener('click', () => {
  const attachmentCount = attachmentInputs.querySelectorAll('input[name="certifications"]').length;
  if (attachmentCount >= MAX_ATTACHMENTS) return;

  const nextNumber = attachmentCount + 1;
  const inputId = `certifications-${nextNumber}`;
  const label = document.createElement('label');
  label.className = 'attachment-input';
  label.htmlFor = inputId;

  const description = document.createElement('span');
  description.textContent = `Attach file ${nextNumber}`;

  const input = document.createElement('input');
  input.id = inputId;
  input.type = 'file';
  input.name = 'certifications';
  input.accept = '.pdf,.png,.jpg,.jpeg';

  label.append(description, input);
  attachmentInputs.append(label);
  attachmentStatus.textContent = `Attachment field ${nextNumber} added.`;
  addAttachmentButton.hidden = nextNumber >= MAX_ATTACHMENTS;
});

function encodeBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(parts.join(''));
}

applicationForm.addEventListener('submit', async event => {
  event.preventDefault();
  applicationStatus.classList.remove('is-error');

  if (!applicationForm.reportValidity()) return;

  const missingChoice = ['availabilityDays[]', 'availabilityShifts[]']
    .find(name => !applicationForm.querySelector(`input[name="${name}"]:checked`));
  if (missingChoice) {
    const firstOption = applicationForm.querySelector(`input[name="${missingChoice}"]`);
    firstOption.setCustomValidity('Select at least one option.');
    firstOption.reportValidity();
    const optionGroup = firstOption.closest('fieldset');
    optionGroup.addEventListener('change', () => firstOption.setCustomValidity(''), { once: true });
    return;
  }

  const selectedFiles = [...applicationForm.querySelectorAll('input[name="certifications"]')]
    .flatMap(input => [...input.files]);
  const totalFileBytes = selectedFiles.reduce((total, file) => total + file.size, 0);
  const supportedFiles = selectedFiles.every(file => {
    const extension = file.name.toLowerCase().split('.').pop();
    return (file.type === 'application/pdf' && extension === 'pdf')
      || (file.type === 'image/png' && extension === 'png')
      || (file.type === 'image/jpeg' && ['jpg', 'jpeg'].includes(extension));
  });
  if (selectedFiles.length > 3
    || selectedFiles.some(file => file.size === 0 || file.size > 2 * 1024 * 1024)
    || totalFileBytes > 6 * 1024 * 1024
    || !supportedFiles) {
    applicationStatus.classList.add('is-error');
    applicationStatus.textContent = 'Attach up to three PDF, PNG, or JPEG files, no larger than 2 MB each.';
    return;
  }

  const values = new FormData(applicationForm);
  const application = {};
  for (const [name, value] of values.entries()) {
    if (name === 'certifications') continue;
    if (name.endsWith('[]')) {
      const key = name.slice(0, -2);
      application[key] = [...(application[key] || []), value];
    } else {
      application[name] = value;
    }
  }
  const submitButton = applicationForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  applicationStatus.textContent = 'Submitting your application…';

  try {
    const attachments = await Promise.all(selectedFiles.map(async file => ({
      name: file.name,
      type: file.type,
      contentBase64: encodeBase64(await file.arrayBuffer()),
    })));
    const applicationPayload = {
      ...application,
      trainings: application.trainings || [],
      attachments,
      consent: values.get('consent') === 'on',
    };
    const response = await fetch(applicationForm.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(applicationPayload),
    });
    const result = await response.json();
    if (!response.ok) {
      applicationStatus.classList.add('is-error');
      applicationStatus.textContent = result.error || 'Your application could not be submitted. Please contact HCR.';
      return;
    }

    applicationForm.reset();
    applicationStatus.textContent = 'Your application was sent to HCR. For follow-up, call (207) 730-9712.';
  } catch {
    applicationStatus.classList.add('is-error');
    applicationStatus.textContent = 'We could not confirm submission. Please contact HCR before trying again.';
  } finally {
    submitButton.disabled = false;
  }
});
