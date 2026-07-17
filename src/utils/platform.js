// src/utils/platform.js
const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const isWindows = /Windows/i.test(userAgent);
const isMac = /Macintosh|Mac OS X/i.test(userAgent);
const isLinux = /Linux/i.test(userAgent) && !/Android/i.test(userAgent);
const isDevelopment = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development';

const isCreateTray = false;
const isCreateMpris = false;

module.exports = {
  isWindows,
  isMac,
  isLinux,
  isDevelopment,
  isCreateTray,
  isCreateMpris
};
