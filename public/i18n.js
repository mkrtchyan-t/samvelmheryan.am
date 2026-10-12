(function () {
  'use strict';

  var T = {
    en: {
      // Navigation
      'nav.books':   'Books',
      'nav.films':   'Films',
      'nav.gallery': 'Gallery',
      'nav.contact': 'Contact',

      // Subpage layout
      'sub.back': 'Back',
      'sub.home': '← Home',

      // Home — section titles
      'section.books':   'Books',
      'section.films':   'Films',
      'section.gallery': 'Gallery',
      'section.contact': 'CONTACT',

      // Home — contact
      'contact.sub':        'For inquiries or collaboration:',
      'contact.emailLabel': 'Email',
      'contact.follow':     'Follow',
      'contact.copy':       '© Samvel Mheryan. All rights reserved.',

      // Home — UI
      'ui.seeMore': 'See More',

      // Gallery page
      'gallery.title': 'Gallery',
    },

    ru: {
      // Navigation
      'nav.books':   'Книги',
      'nav.films':   'Фильмы',
      'nav.gallery': 'Галерея',
      'nav.contact': 'Контакт',

      // Subpage layout
      'sub.back': 'Назад',
      'sub.home': '← Главная',

      // Home — section titles
      'section.books':   'Книги',
      'section.films':   'Фильмы',
      'section.gallery': 'Галерея',
      'section.contact': 'КОНТАКТ',

      // Home — contact
      'contact.sub':        'По вопросам и сотрудничеству:',
      'contact.emailLabel': 'Эл. почта',
      'contact.follow':     'Подписаться',
      'contact.copy':       '© Самвел Мгерян. Все права защищены.',

      // Home — UI
      'ui.seeMore': 'Смотреть ещё',

      // Gallery page
      'gallery.title': 'Галерея',
    }
  };

  function saveOriginals() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      if (!el.dataset.i18nOrig) {
        el.dataset.i18nOrig = el.textContent.trim();
      }
    });
  }

  function applyLang(lang) {
    saveOriginals();

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.dataset.i18n;
      if (lang === 'hy') {
        if (el.dataset.i18nOrig !== undefined) {
          el.textContent = el.dataset.i18nOrig;
        }
      } else {
        var dict = T[lang];
        if (dict && dict[key] !== undefined) {
          el.textContent = dict[key];
        }
      }
    });

    // Admin-managed content: data-t-en / data-t-ru hold translations, falling back to Armenian
    document.querySelectorAll('[data-t-en], [data-t-ru]').forEach(function (el) {
      if (el.dataset.tOrig === undefined) {
        el.dataset.tOrig = el.textContent;
      }
      var tr = lang === 'hy' ? '' : el.getAttribute('data-t-' + lang);
      el.textContent = tr || el.dataset.tOrig;
    });

    document.documentElement.lang = lang === 'hy' ? 'hy' : lang;

    try {
      localStorage.setItem('lang', lang);
    } catch (e) {}

    document.querySelectorAll('.lang-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    saveOriginals();

    var savedLang = 'hy';
    try {
      savedLang = localStorage.getItem('lang') || 'hy';
    } catch (e) {}

    applyLang(savedLang);

    document.querySelectorAll('.lang-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyLang(btn.dataset.lang);
      });
    });
  });
})();
