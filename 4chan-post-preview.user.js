// ==UserScript==
// @name        4chan Post Preview
// @description Post formatting preview
// @namespace   https://github.com/marktaiwan/
// @homepageURL https://github.com/marktaiwan/4chan-Post-Preview
// @supportURL  https://github.com/marktaiwan/4chan-Post-Preview/issues
// @version     1.1.3
// @author      Fillyanon, Marker
// @license     GPLv3
// @match       *://boards.4channel.org/*/thread/*
// @match       *://boards.4chan.org/*/thread/*
// @grant       none
// ==/UserScript==

const SCRIPT_ID = 'post-preview';
const css = `
.${SCRIPT_ID} hr {
  margin: 4px 0px;
}
.${SCRIPT_ID} {
  overflow-y: auto;
}
.${SCRIPT_ID}-blockquote {
  margin: 5px;
  min-height: 80px;
  max-height: 300px;
  word-wrap: break-word;
}
.${SCRIPT_ID} summary {
  margin: 0px 5px;
  cursor: pointer;
  user-select: none;
}
`;

// Backup implementation of $L in case the userscript is executed in a sandboxed context
const $L = window.$L ?? {
  blue: '4channel.org',
  red: '4chan.org',
  nws: {
    'aco': 1, 'b': 1, 'bant': 1, 'd': 1, 'e': 1, 'f': 1, 'gif': 1, 'h': 1,
    'hc': 1, 'hm': 1, 'hr': 1, 'i': 1, 'ic': 1, 'pol': 1, 'r': 1, 'r9k': 1,
    's': 1, 's4s': 1, 'soc': 1, 't': 1, 'trash': 1, 'u': 1, 'wg': 1, 'y': 1
  },
  d(id) {
    return (this.nws[id]) ? this.red : this.blue;
  },
};

const spoilerStripNoSpace = str => str.replace((/(?<=\S)\[spoiler\](.*)\[\/spoiler\](?=\S)/g), '$1');
const spoilerRemoveEmpty = str => str.replace((/\[spoiler\]\[\/spoiler\]/g), '');
const escapeAngleBrackets = str => str.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const postLinkRegExpComponent = String.raw`>>(?:>/([a-z]+)/(\w+)|(\d+))`;

class Parser {
  tokenList = [];
  openQuote = false;
  openSpoilers = 0;
  staged = '';
  tokens = {
    link: postLinkRegExpComponent,
    quote: '>',
    spoilerOpen: '\\[spoiler\\]',
    spoilerClose: '\\[/spoiler\\]',
    linebreak: '\\n',
  };
  // use named capture groups to help identify matches
  matchToken = new RegExp(
    Object
      .entries(this.tokens)
      .map(([name, pattern]) => `(?<${name}>${pattern})`)
      .join('|')
  );
  parse(str) {
    // preprocess
    str = spoilerStripNoSpace(str);
    str = spoilerRemoveEmpty(str);
    this.tokenize(str);
    return this.render();
  }
  tokenize(str) {
    const splitAtToken = (str, tokenLength, index) => [
      str.slice(0, index),
      str.slice(index + tokenLength),
    ];

    // reset values
    this.tokenList = [];
    this.openQuote = false;
    this.openSpoilers = 0;
    this.staged = '';

    let result;
    do {
      result = str.match(this.matchToken);
      if (result) {
        const token = result[0];
        const [splitLeft, splitRight] = splitAtToken(str, token.length, result.index);
        const tokenType = Object.keys(this.tokens).find(name => result.groups[name]);

        str = splitRight;
        this.staged += splitLeft;

        switch (tokenType) {
          case 'link':
            this.pushToken(new PostLink(token));
            break;
          case 'quote':
            if (
              // start of string or preceded by linebreak
              !this.staged.length
              && (this.previousToken() == null
                || this.previousToken() instanceof LineBreak)
              // not within a spoiler tag
              && this.openSpoilers == 0
            ) {
              this.openQuote = true;
              this.pushToken(new QuoteOpen());
            }

            // '>' is always displayed
            this.staged += token;
            break;
          case 'spoilerOpen':
            this.openSpoilers++;
            if (this.openSpoilers < 3) this.pushToken(new SpoilerOpen());
            break;
          case 'spoilerClose':
            if (this.openSpoilers > 0) {
              if (this.openSpoilers < 3) this.pushToken(new SpoilerClose());
              this.openSpoilers--;
            } else {
              // unmatched '[/spoiler]'
              this.staged += token;
            }
            break;
          case 'linebreak':
            this.pushToken(new LineBreak());
            break;
        }
      } else {
        if (str.length) this.staged += str;
        if (this.staged.length) this.commit();
        if (this.openQuote) this.pushToken(new QuoteClose());
        while (this.openSpoilers-- > 0) this.pushToken(new SpoilerClose());
      }
    } while (result !== null);
  }
  render() {
    return this.tokenList
            .map(token => token.toString())
            .join('');
  }
  commit() {
    if (this.staged.length > 0) {
      this.tokenList.push(new TextToken(this.staged));
      this.staged = '';
    }
  }
  pushToken(token) {
    // commit any plain text to the left of the matched token
    this.commit();
    // close quote
    if (
      this.openQuote
      && (token.type == 'spoiler' || token.type == 'linebreak')
    ) {
      this.tokenList.push(new QuoteClose());
      this.openQuote = false;
    }
    this.tokenList.push(token);
  }
  previousToken() {
    const arr = this.tokenList;
    return (arr.length) ? arr[arr.length - 1] : null;
  }
}

class Token {
  type;
  formatted = '';
  toString() {
    return this.formatted;
  }
}
class TextToken extends Token {
  type = 'text';
  formatted = '';
  constructor(str = '') {
    super();
    this.formatted = escapeAngleBrackets(str);
  }
}
class QuoteOpen extends Token {
  type = 'quote';
  formatted = '<span class="quote">';
}
class QuoteClose extends Token {
  type = 'quote';
  formatted = '</span>';
}
class SpoilerOpen extends Token {
  type = 'spoiler';
  formatted = '<s>';
}
class SpoilerClose extends Token {
  type = 'spoiler';
  formatted = '</s>';
}
class LineBreak extends Token {
  type = 'linebreak';
  formatted = '<br>';
}
class PostLink extends Token {
  type = 'link';
  raw = '';
  formatted = '';
  constructor(str) {
    if (typeof str !== 'string' || str.length == 0) {
      throw new Error('invalid argument');
    }
    super();
    this.raw = str;

    /*
     * The capture groups corresponds to:
     *  >>>/{$1}/{$2}  - off-board or catalog links
     *  >>{$3}         - normal links
     */
    const re = new RegExp(postLinkRegExpComponent);
    const match = re.exec(str);
    const [, $1, $2, $3] = match;
    const boardId = $1;
    const host = $L.d(boardId);
    const localPost = ($3 && document.getElementById(`p${$3}`));
    const catalogSearch = (boardId && (/[^\d]/).test($2));

    const text = escapeAngleBrackets((localPost || catalogSearch) ? this.raw : this.raw + ' →');
    const href = (localPost)
      ? `#p${$3}`
      : (catalogSearch)
      ? `${window.location.protocol}//boards.${host}/${boardId}/catalog#s=${encodeURIComponent($2)}`
      : 'javascript:void(0);';
      // The last one is for external posts i.e. (!catalogSearch && !localPost)
      // because annoyingly, there is no way of getting a post's OP via 4chan's API

    this.formatted = `<a href="${href}" class="quotelink">${text}</a>`;
  }
}

const creationObserver = (function () {
const observedNodes = new WeakSet;
const callbacks = [];
const executeCallback = (fn, node) => {
  if (observedNodes.has(node)) return;
  observedNodes.add(node);
  fn(node);
};
const obs = new MutationObserver(mutationRecords => {
  mutationRecords.forEach(mutation => {
    mutation.addedNodes.forEach(node => {
      if (!(node instanceof HTMLElement)) return;
      callbacks.forEach(([selector, fn]) => {
        if (node.matches(selector)) executeCallback(fn, node);
        node.querySelectorAll(selector).forEach(childNode => executeCallback(fn, childNode));
      });
    });
  });
});
obs.observe(document.body, { childList: true, subtree: true });
return function (selector, fn) {
  document.querySelectorAll(selector).forEach(node => executeCallback(fn, node));
  callbacks.push([selector, fn]);
};
})();

const selectors = [
  'form[name="post"]',   // 4chan default post
  'form[name="qrPost"]', // 4chan quick reply form
  'div#qr form',         // 4chanX quick reply form
].join(', ');


// Inject the style.
const style = document.createElement('style');
style.setAttribute('type', 'text/css');
style.innerHTML = css;
document.head.appendChild(style);

function updatePreview() {
  document.querySelectorAll(`.${SCRIPT_ID}-blockquote`).forEach(bq => {
    // Get the textarea associated with the preview
    const form = bq.closest(selectors);
    const textarea = form.querySelector('textarea');
    bq.innerHTML = PostParser.parse(textarea.value);
  });
}

// default setting
localStorage[`${SCRIPT_ID}_preview_visibility`] ??= 'false';

const PostParser = new Parser();
creationObserver(selectors, form => {
  const textarea = form.querySelector('textarea');

  const preview = document.createElement('div');
  preview.classList.add(SCRIPT_ID);
  preview.style.width = textarea.offsetWidth + 'px';

  const details = document.createElement('details');
  details.toggleAttribute('open', localStorage[`${SCRIPT_ID}_preview_visibility`] === 'true');

  const summary = document.createElement('summary');
  summary.innerText = 'Click to toggle preview';
  summary.addEventListener('click', e => {
    if (e.button !== 0) return;
    localStorage[`${SCRIPT_ID}_preview_visibility`] = !details.hasAttribute('open');
  });

  const bq = document.createElement('blockquote');
  bq.classList.add(`${SCRIPT_ID}-blockquote`);

  details.append(summary, bq);
  preview.append(details);
  form.append(
    document.createElement('hr'),
    preview,
  );

  new ResizeObserver(() => {
    preview.style.width = textarea.offsetWidth + 'px';
  }).observe(textarea);

  if (Main) {
    preview.addEventListener('mouseover', Main.onThreadMouseOver);
    preview.addEventListener('mouseout', Main.onThreadMouseOut);
  }

  // handle user inputs
  ['input','paste'].forEach(eventType => textarea.addEventListener(eventType, updatePreview));

  /*
   * Update preview on adding quotes or form submission
   * by hooking into textarea's 'value' getter.
   * https://stackoverflow.com/questions/38802193/
   */
  const findDescriptor = (obj, prop) => {
    if (obj !== null) {
      return Object.hasOwnProperty.call(obj, prop)
        ? Object.getOwnPropertyDescriptor(obj, prop)
        : findDescriptor(Object.getPrototypeOf(obj), prop);
    }
  };
  const {set: origSet, get: origGet} = findDescriptor(textarea, 'value');
  Object.defineProperty(textarea, 'value', {
    configurable: true,
    enumerable: true,
    set(val) {
      origSet.call(this, val);
      updatePreview();
    },
    get: origGet,
  });

  updatePreview();
});
