(function (global) {
  'use strict';

  function toNumber(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function WordCloud(element, options) {
    if (!element) {
      throw new Error('WordCloud: container element is required.');
    }

    const opts = Object.assign(
      {
        list: [],
        minFont: 14,
        maxFont: 96,
        color: null,
        rotateRatio: 0,
        drawOutOfBound: false
      },
      options || {}
    );

    const list = Array.isArray(opts.list) ? opts.list : [];
    const width = element.clientWidth || element.offsetWidth || 320;
    const height = element.clientHeight || element.offsetHeight || 240;

    element.innerHTML = '';

    if (getComputedStyle(element).position === 'static') {
      element.style.position = 'relative';
    }
    element.style.overflow = 'hidden';

    const palette = typeof opts.color === 'function' ? opts.color : () => '#64748b';
    const placed = [];

    list.forEach((item, index) => {
      const word = Array.isArray(item) ? item[0] : item;
      const weight = Array.isArray(item) ? item[1] : opts.minFont;
      if (!word) {
        return;
      }

      const span = document.createElement('span');
      span.className = 'wordcloud-item';
      span.textContent = word;
      span.style.position = 'absolute';
      const fontSize = Math.max(opts.minFont, Math.min(opts.maxFont, toNumber(weight, opts.minFont)));
      span.style.fontSize = `${fontSize}px`;
      span.style.fontWeight = '600';
      span.style.lineHeight = '1';
      span.style.color = palette(index, word, weight);
      span.style.whiteSpace = 'nowrap';
      span.style.visibility = 'hidden';
      span.style.transform = 'translateZ(0)';

      if (opts.rotateRatio > 0 && Math.random() < opts.rotateRatio) {
        const rotation = Math.random() > 0.5 ? 90 : -90;
        span.style.transform += ` rotate(${rotation}deg)`;
      }

      element.appendChild(span);

      const spanWidth = span.offsetWidth;
      const spanHeight = span.offsetHeight;

      if (!spanWidth || !spanHeight) {
        element.removeChild(span);
        return;
      }

      const position = placeWord(width, height, spanWidth, spanHeight, placed, opts.drawOutOfBound);
      if (position) {
        span.style.left = `${position.x}px`;
        span.style.top = `${position.y}px`;
        span.style.visibility = 'visible';
        placed.push({
          x: position.x,
          y: position.y,
          width: spanWidth,
          height: spanHeight
        });
      } else {
        span.style.left = `${Math.max(0, Math.min(width - spanWidth, Math.random() * (width - spanWidth)))}px`;
        span.style.top = `${Math.max(0, Math.min(height - spanHeight, Math.random() * (height - spanHeight)))}px`;
        span.style.visibility = 'visible';
        placed.push({
          x: parseFloat(span.style.left) || 0,
          y: parseFloat(span.style.top) || 0,
          width: spanWidth,
          height: spanHeight
        });
      }
    });

    return element;
  }

  function placeWord(width, height, boxWidth, boxHeight, placed, allowOutOfBound) {
    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.sqrt(width * width + height * height);
    const step = 4;
    let angle = 0;
    let radius = 0;
    let attempts = 0;

    while (radius < maxRadius && attempts < 2000) {
      const x = centerX + radius * Math.cos(angle) - boxWidth / 2;
      const y = centerY + radius * Math.sin(angle) - boxHeight / 2;

      if (
        (allowOutOfBound || (x >= 0 && y >= 0 && x + boxWidth <= width && y + boxHeight <= height)) &&
        !collides(x, y, boxWidth, boxHeight, placed)
      ) {
        return { x: Math.round(x), y: Math.round(y) };
      }

      angle += (step * Math.PI) / 180;
      radius += step * 0.8;
      attempts += 1;
    }

    return null;
  }

  function collides(x, y, width, height, placed) {
    return placed.some(item => {
      return !(
        x + width <= item.x ||
        item.x + item.width <= x ||
        y + height <= item.y ||
        item.y + item.height <= y
      );
    });
  }

  global.WordCloud = WordCloud;
})(typeof window !== 'undefined' ? window : globalThis);
