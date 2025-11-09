// Глобальні змінні
let currentCommunity = '';
let currentPrice = 0;

// Покращена функція для отримання telegram_id
async function getTelegramId() {
    // Головний спосіб - Telegram Web App
    if (window.Telegram && Telegram.WebApp) {
        const user = Telegram.WebApp.initDataUnsafe.user;
        if (user && user.id) {
            console.log('✅ Telegram ID отримано автоматично:', user.id);
            return user.id.toString();
        }
    }
    
    // Резервний спосіб - з URL параметрів
    const urlParams = new URLSearchParams(window.location.search);
    const tgId = urlParams.get('tg_id');
    if (tgId) {
        console.log('✅ Telegram ID отримано з URL:', tgId);
        localStorage.setItem('telegram_id', tgId);
        return tgId;
    }
    
    // Перевірка localStorage (якщо вже вводили раніше)
    const savedId = localStorage.getItem('telegram_id');
    if (savedId) {
        console.log('✅ Telegram ID знайдено в localStorage:', savedId);
        return savedId;
    }
    
    console.log('❌ Telegram ID не знайдено');
    return null;
}

function openCommunityTerms() {
    // Показуємо модальне вікно з форматом спілкування
    const modal = new bootstrap.Modal(document.getElementById('communityFormatModal'));
    modal.show();
}
// Функція для відкриття в Telegram
function openInTelegram() {
    // Використовуємо поточну URL сторінки
    const currentUrl = encodeURIComponent(window.location.href);
    const telegramUrl = `https://t.me/VilniZalezhni_bot?start=get_id_${currentUrl}`;
    
    // Відкриваємо посилання
    window.open(telegramUrl, '_blank');
    
    // Показуємо інструкцію
    showAlert('Відкрито Telegram. Напишіть боту щоб отримати ваш Telegram ID.', 'info');
}

// Функція показу допомоги по Telegram ID
function showTelegramIdHelp() {
    // Видаляємо попередні сповіщення
    const existingAlert = document.querySelector('.telegram-id-alert');
    if (existingAlert) {
        existingAlert.remove();
    }
    
    const helpHtml = `
        <div class="alert alert-warning alert-dismissible fade show telegram-id-alert" role="alert" 
             style="position: fixed; top: 100px; right: 20px; z-index: 9999; min-width: 400px; max-width: 500px;">
            <h5 class="alert-heading">📱 Потрібен Telegram ID</h5>
            <p class="mb-3">Для завершення реєстрації нам потрібен ваш Telegram ID.</p>
            <div class="d-flex gap-2 flex-wrap">
                <button type="button" class="btn btn-sm btn-success" onclick="openInTelegram()">
                    <i class="fab fa-telegram me-1"></i>Отримати автоматично
                </button>
                <button type="button" class="btn btn-sm btn-outline-primary" onclick="showManualInput()">
                    <i class="fas fa-keyboard me-1"></i>Ввести вручну
                </button>
                <button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="alert">
                    <i class="fas fa-times me-1"></i>Закрити
                </button>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', helpHtml);
}

// Функція для ручного введення Telegram ID
function showManualInput() {
    const manualHtml = `
        <div class="modal fade" id="manualTelegramModal" tabindex="-1">
            <div class="modal-dialog modal-sm">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Введіть Telegram ID</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p class="small text-muted mb-3">
                            <i class="fas fa-info-circle me-1"></i>
                            Щоб отримати ваш Telegram ID, напишіть <strong>/id</strong> боту 
                            <a href="https://t.me/VilniZalezhni_bot" target="_blank">@VilniZalezhni_bot</a>
                        </p>
                        <div class="mb-3">
                            <label class="form-label small">Ваш Telegram ID:</label>
                            <input type="text" class="form-control" id="inputTelegramId" placeholder="Наприклад: 123456789">
                            <div class="form-text">Тільки цифри, без символів</div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Скасувати</button>
                        <button type="button" class="btn btn-primary" onclick="saveManualTelegramId()">Зберегти</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    if (!document.getElementById('manualTelegramModal')) {
        document.body.insertAdjacentHTML('beforeend', manualHtml);
    }
    
    // Закриваємо попереднє сповіщення
    const existingAlert = document.querySelector('.telegram-id-alert');
    if (existingAlert) {
        existingAlert.remove();
    }
    
    const modal = new bootstrap.Modal(document.getElementById('manualTelegramModal'));
    modal.show();
}

// Збереження ручного введення Telegram ID
function saveManualTelegramId() {
    const manualId = document.getElementById('inputTelegramId').value.trim();
    
    if (manualId && /^\d+$/.test(manualId)) {
        localStorage.setItem('telegram_id', manualId);
        console.log('💾 Telegram ID збережено:', manualId);
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('manualTelegramModal'));
        modal.hide();
        
        showAlert('Telegram ID збережено! Можете продовжити реєстрацію.', 'success');
        
        // Оновлюємо кнопку оплати
        updatePaymentButton();
    } else {
        showAlert('Будь ласка, введіть коректний Telegram ID (тільки цифри)', 'error');
    }
}

// Перевірка перед оплатою
async function validateBeforePayment() {
    const telegramId = await getTelegramId();
    
    if (!telegramId) {
        showTelegramIdHelp();
        return false;
    }
    
    return telegramId;
}

// Функція для відображення модального вікна підтвердження оплати
function showPaymentConfirmation(community, price) {
    currentCommunity = community;
    currentPrice = price;
    
    // Отримуємо назву спільноти для відображення
    const communityNames = {
        nikotin: 'Вільні від нікотину',
        food: 'Вільні від їжі',
        social: 'Вільні від думки інших'
    };
    
    // Оновлюємо інформацію в модальному вікні
    document.getElementById('communityName').textContent = communityNames[community];
    document.getElementById('finalPrice').textContent = price;
    
    // Скидаємо форму
    document.getElementById('telegramUsername').value = '';
    document.getElementById('userPhone').value = '';
    document.getElementById('agreeTermsCheckbox').checked = false;
    updatePaymentButton();
    
    // Показуємо модальне вікно
    const modal = new bootstrap.Modal(document.getElementById('paymentConfirmationModal'));
    modal.show();
}

// Функція для оновлення стану кнопки оплати
function updatePaymentButton() {
    const username = document.getElementById('telegramUsername').value.trim();
    const phone = document.getElementById('userPhone').value.trim();
    const agreeTerms = document.getElementById('agreeTermsCheckbox').checked;
    const paymentBtn = document.getElementById('proceedPaymentBtn');
    
    const isFormValid = username && isValidPhone(phone) && agreeTerms;
    
    if (isFormValid) {
        paymentBtn.disabled = false;
        paymentBtn.classList.remove('btn-disabled');
        paymentBtn.classList.add('btn-enabled');
    } else {
        paymentBtn.disabled = true;
        paymentBtn.classList.remove('btn-enabled');
        paymentBtn.classList.add('btn-disabled');
    }
}

// Функція для перевірки номера телефону
function isValidPhone(phone) {
    const phoneRegex = /^\+380\d{9}$/;
    return phoneRegex.test(phone);
}

// Функція для обробки переходу до оплати
async function proceedToPayment() {
    const username = document.getElementById('telegramUsername').value.trim();
    const phone = document.getElementById('userPhone').value.trim();
    
    if (!username || !isValidPhone(phone)) {
        showAlert('Будь ласка, заповніть коректно всі поля', 'error');
        return;
    }
    
    if (!document.getElementById('agreeTermsCheckbox').checked) {
        showAlert('Будь ласка, погодьтеся з умовами участі', 'error');
        return;
    }
    
    // Перевірка наявності telegram_id
    const telegramId = await validateBeforePayment();
    if (!telegramId) {
        return; // Допомога вже показана
    }
    
    console.log('✅ Всі перевірки пройдено, telegram_id:', telegramId);
    
    try {
        // Показуємо індикатор завантаження
        const paymentBtn = document.getElementById('proceedPaymentBtn');
        paymentBtn.disabled = true;
        paymentBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Обробка...';
        
        console.log('📨 Відправка даних реєстрації:', { 
            username, 
            phone, 
            community: currentCommunity, 
            amount: currentPrice,
            telegramId 
        });
        
        // Відправляємо запит на сервер
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                telegramUsername: username,
                userPhone: phone,
                community: currentCommunity,
                amount: currentPrice,
                telegramId: telegramId
            })
        });
        
        const result = await response.json();
        console.log('🔍 Відповідь від сервера:', result);
        
        if (result.success) {
            console.log('✅ Реєстрація успішна, перенаправлення на оплату');
            // Перенаправляємо на сторінку оплати
            window.location.href = result.paymentUrl;
        } else {
            console.error('❌ Помилка реєстрації:', result.error);
            showAlert(result.error || 'Помилка реєстрації', 'error');
            // Відновлюємо кнопку
            paymentBtn.disabled = false;
            paymentBtn.innerHTML = '<i class="fas fa-lock me-2"></i>Перейти до оплати';
        }
        
    } catch (error) {
        console.error('❌ Помилка зʼєднання:', error);
        showAlert('Помилка зʼєднання з сервером', 'error');
        // Відновлюємо кнопку
        const paymentBtn = document.getElementById('proceedPaymentBtn');
        paymentBtn.disabled = false;
        paymentBtn.innerHTML = '<i class="fas fa-lock me-2"></i>Перейти до оплати';
    }
}

// Функція для відображення сповіщень
function showAlert(message, type = 'info') {
    // Видаляємо попередні сповіщення
    const existingAlert = document.querySelector('.custom-alert');
    if (existingAlert) {
        existingAlert.remove();
    }
    
    const alertClass = type === 'error' ? 'alert-danger' : 
                      type === 'success' ? 'alert-success' : 'alert-info';
    const alertHtml = `
        <div class="alert ${alertClass} custom-alert alert-dismissible fade show" role="alert" 
             style="position: fixed; top: 100px; right: 20px; z-index: 9999; min-width: 300px;">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', alertHtml);
    
    // Автоматично видаляємо сповіщення через 5 секунд
    setTimeout(() => {
        const alert = document.querySelector('.custom-alert');
        if (alert) {
            alert.remove();
        }
    }, 5000);
}

// Функція для форматування номера телефону
function formatPhoneNumber(input) {
    let value = input.value.replace(/\D/g, '');
    
    if (value.startsWith('380')) {
        value = '+' + value;
    } else if (value.startsWith('80')) {
        value = '+3' + value;
    } else if (value.startsWith('0')) {
        value = '+38' + value;
    }
    
    // Обмежуємо довжину
    if (value.length > 13) {
        value = value.substring(0, 13);
    }
    
    input.value = value;
}

// Функція для ініціалізації Telegram Web App
function initTelegramWebApp() {
    if (window.Telegram && Telegram.WebApp) {
        console.log('📱 Ініціалізація Telegram Web App');
        
        // Розгортаємо на весь екран
        Telegram.WebApp.expand();
        
        // Отримуємо інформацію про користувача
        const user = Telegram.WebApp.initDataUnsafe.user;
        if (user) {
            console.log('👤 Інформація про користувача:', user);
            
            // Автозаповнення username якщо доступно
            const usernameInput = document.getElementById('telegramUsername');
            if (usernameInput && user.username) {
                usernameInput.value = user.username;
                updatePaymentButton();
            }
            
            // Показуємо інформацію про користувача
            const userInfoElement = document.getElementById('userInfo');
            if (userInfoElement) {
                userInfoElement.innerHTML = `
                    <small class="text-muted">
                        👋 Вітаємо, ${user.first_name || 'користувач'}! 
                        ${user.username ? `(@${user.username})` : ''}
                    </small>
                `;
            }
            
            // Автоматично зберігаємо telegram_id
            if (user.id) {
                localStorage.setItem('telegram_id', user.id.toString());
                console.log('💾 Telegram ID збережено автоматично:', user.id);
            }
        }
        
        // Змінюємо тему відповідно до Telegram
        Telegram.WebApp.setHeaderColor('#c94c4c');
        Telegram.WebApp.setBackgroundColor('#EAE7DC');
        
        console.log('✅ Telegram Web App ініціалізовано');
    }
}

// Обробники подій
document.addEventListener('DOMContentLoaded', function() {
    console.log('🤖 Сайт "Вільні - Залежні" завантажено успішно!');
    
    // Ініціалізуємо Telegram Web App
    initTelegramWebApp();
    
    // Додаємо обробники для полів форми
    const usernameInput = document.getElementById('telegramUsername');
    const phoneInput = document.getElementById('userPhone');
    const termsCheckbox = document.getElementById('agreeTermsCheckbox');
    
    if (usernameInput) {
        usernameInput.addEventListener('input', updatePaymentButton);
        
        // Додаємо підказку про формат username
        usernameInput.addEventListener('focus', function() {
            if (!this.value.startsWith('@')) {
                this.placeholder = 'Наприклад: username (без @)';
            }
        });
    }
    
    if (phoneInput) {
        phoneInput.addEventListener('input', function() {
            formatPhoneNumber(this);
            updatePaymentButton();
        });
        
        // Додаємо підказку про формат телефону
        phoneInput.addEventListener('focus', function() {
            if (!this.value) {
                this.placeholder = '+380XXXXXXXXX';
            }
        });
    }
    
    if (termsCheckbox) {
        termsCheckbox.addEventListener('change', updatePaymentButton);
    }
    
    // Обробник для кнопки "Повернутись на початок"
    const backToTopLink = document.getElementById('backToTopLink');
    if (backToTopLink) {
        backToTopLink.addEventListener('click', function(e) {
            e.preventDefault();
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    }
    
    // Плавна прокрутка для навігаційних посилань (виключаємо модальні вікна та backToTopLink)
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        // Пропускаємо посилання з data-bs-toggle (модальні вікна)
        if (anchor.hasAttribute('data-bs-toggle')) {
            return;
        }
        
        // Пропускаємо посилання "Повернутись на початок" (воно вже обробляється вище)
        if (anchor.id === 'backToTopLink') {
            return;
        }
        
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
    
    // Додаємо інформацію про telegram_id для дебагу
    const debugInfo = document.createElement('div');
    debugInfo.style.cssText = 'position: fixed; bottom: 10px; right: 10px; background: rgba(0,0,0,0.7); color: white; padding: 5px 10px; border-radius: 5px; font-size: 12px; z-index: 9999;';
    debugInfo.innerHTML = 'Telegram ID: <span id="debugTelegramId">не визначено</span>';
    document.body.appendChild(debugInfo);
    
    // Оновлюємо інформацію про telegram_id
    getTelegramId().then(telegramId => {
        document.getElementById('debugTelegramId').textContent = telegramId || 'не визначено';
    });
});

// Функція для перевірки статусу користувача
async function checkUserStatus(username) {
    try {
        const response = await fetch(`/api/user/${username}`);
        const result = await response.json();
        return result;
    } catch (error) {
        console.error('Помилка перевірки статусу:', error);
        return null;
    }
}

// Експорт функцій для глобального використання
window.showPaymentConfirmation = showPaymentConfirmation;
window.proceedToPayment = proceedToPayment;
window.formatPhoneNumber = formatPhoneNumber;
window.updatePaymentButton = updatePaymentButton;
window.openInTelegram = openInTelegram;
window.showTelegramIdHelp = showTelegramIdHelp;
window.showManualInput = showManualInput;
window.saveManualTelegramId = saveManualTelegramId;