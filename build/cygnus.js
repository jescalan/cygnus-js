var _this2 = this,
    _arguments = arguments;

/* global cygnus, Blob, Worker, XMLHttpRequest */

module.exports = {
  supportsHistory: !!window.history,
  supportsWorkers: !!window.Worker,
  supportsPromises: !!Promise,
  ready: false,
  pages: {},
  init: () => {
    // Exit if history api, workers and promises aren't all supported
    if (!_this2.supportsHistory || !_this2.supportsWorkers || !_this2.supportsPromises) {
      console.info('[Cygnus]: cygnus is not supported in this browser.');
      return false;
    }

    if (!_this2.ready) {
      window.cygnus = _this2; // Expose to global scope
      window.onpopstate = _this2.handlePopState; // Handle popstate events
      _this2.ready = true;
    }

    // Start up the worker if it hasn't already been started
    if (typeof _this2.cygnusWorker === 'undefined') {
      const workerSrc = document.querySelector('[data-cygnus-worker]').getAttribute('data-src');
      cygnus.ajaxPromise(workerSrc).then(response => {
        const blob = new Blob([response]);
        cygnus.cygnusWorker = new Worker(window.URL.createObjectURL(blob));
        cygnus.completeInit();
      }, error => {
        console.error('[Cygnus]: Worker initialisation failed!', error);
      });
    } else {
      _this2.completeInit();
    }
  },
  completeInit: () => {
    // Respond to the worker
    cygnus.cygnusWorker.onmessage = e => {
      cygnus.receivePageData(JSON.parse(e.data));
    };

    // Add current page without re-fectching it
    if (!cygnus.pages[window.location.href]) cygnus.getCurrentPage();

    // Get list of links and send them off to the worker
    const links = cygnus.getLinks();
    for (const k of links) {
      links.map(() => cygnus.dispatchLink(k, links[k]));
    }

    // Handle clicks on links
    cygnus.catchLinks(links);
  },
  getCurrentPage: () => {
    console.info("[Cygnus]: Current page isn't in store. Adding from html already loaded in browser.");
    // Add the current page's html to the store
    _this2.pages[window.location.href] = cygnus.parseHTML(document.documentElement.outerHTML);
    const messageData = { task: 'add', link: window.location.href };
    // Notify the worker that this page doesn't need to be fetched
    _this2.cygnusWorker.postMessage(JSON.stringify(messageData));
  },
  getLinks: () => {
    let documentLinks = document.querySelectorAll('a[href]');
    documentLinks = Array.prototype.slice.call(documentLinks, 0);
    return documentLinks.filter(_this2.filterLinks);
  },
  filterLinks: link => {
    return link.hostname === window.location.hostname;
  },
  dispatchLink: (key, link) => {
    // We don't dispatch the link to the worker if it has already been fetched
    if (!_this2.pages[link]) {
      const messageData = { task: 'fetch', link: link.href };
      _this2.cygnusWorker.postMessage(JSON.stringify(messageData));
    }
  },
  catchLinks: links => {
    const _this = _this2;
    links.forEach((link, i) => {
      // We clone these links in case they already have eventlisteners applied.
      // This removes them
      const clone = link.cloneNode(true);
      link.parentNode.replaceChild(clone, link);
      clone.addEventListener('click', e => {
        e.preventDefault();
        if (_this2.href !== window.location.href) _this.startLoadPage(_this2.href, true);
      });
    });
  },
  handlePopState: event => {
    if (cygnus.ready) {
      cygnus.startLoadPage(document.location);
      return true;
    }
  },
  startLoadPage: (href, click = false) => {
    // Get the page from the store. We use "cygnus" rather than "this" here as
    // this method can be called from outside the local scope
    const page = cygnus.pages[href];

    // If the requested page isn't in the store for some reason, navigate as
    // normal
    if (!page) {
      window.location.assign(href);
      return false;
    }

    // Outro animation...
    const outro = page.querySelector('body').getAttribute('data-outro');
    if (outro && !!cygnus.isFunction(outro, window)) {
      cygnus.getFunction(outro, window).then(response => {
        cygnus.completeLoadPage(href, click, page);
      }, () => {
        console.error('[Cygnus]: Outro animation promise errorred. Broken :(');
      });
    } else {
      _this2.completeLoadPage(href, click, page);
    }
  },
  completeLoadPage: (href, click, page) => {
    // If we get this far, the page is in the store and we should update the
    // history object
    if (click) window.history.pushState({ url: href }, '', href);

    // Set the page title from the stored page
    document.title = page.querySelector('title').innerText;

    // Set animation attributes on body tag
    let outro = page.querySelector('body').getAttribute('data-outro');
    let intro = page.querySelector('body').getAttribute('data-intro');

    if (outro) {
      document.body.setAttribute('data-outro', outro);
    } else {
      document.body.removeAttribute('data-outro');
    }

    if (intro) {
      document.body.setAttribute('data-intro', intro);
    } else {
      document.body.removeAttribute('data-intro');
    }

    // Remove any per-page css file if needed, and add the new one from the page
    // to be loaded if present
    const documentStylesheet = document.querySelector("link[data-rel='page-css']");
    if (documentStylesheet) {
      documentStylesheet.parentNode.removeChild(documentStylesheet);
    }

    const pageStylesheet = page.querySelector("link[data-rel='page-css']");
    if (pageStylesheet) {
      document.querySelector('head').appendChild(pageStylesheet.cloneNode(true));
    }

    // Replace only the content within our page wrapper, as the stuff outside
    // that will remain unchanged
    // TODO: Think about whether we need to change body classes etc
    const wrapper = document.querySelector('.wrap');
    const pageContent = page.querySelector('.wrap').cloneNode(true).innerHTML;
    wrapper.innerHTML = pageContent;

    // Intro animation...
    intro = page.querySelector('body').getAttribute('data-intro');
    if (intro && !!cygnus.isFunction(intro, window)) {
      cygnus.getFunction(intro, window).then(response => {
        cygnus.postLoadPage();
      }, () => {
        console.error('[Cygnus]: Intro animation promise errorred. Broken :(');
      });
    } else {
      _this2.postLoadPage();
    }
  },
  postLoadPage: () => {
    // Re-run the init method. This time it won't start the worker (it is
    // already running). Basically it will just check for new links and dispatch
    // them to the worker if needed
    cygnus.init();
  },
  receivePageData: data => {
    // Add received page to the store
    _this2.pages[data.link] = cygnus.parseHTML(data.html);
  },

  //
  // UTILITY FUNCTIONS
  // These are internal utility functions that are used elsewhere in the script.
  // They aren't really useful externally, and I did have them in a separate
  // utils file originally, but if this is ever going to be bundled up for NPM
  // usage the script will need to be self contained, so I moved them here.
  //

  ajaxPromise: url => {
    return new Promise((resolve, reject) => {
      const req = new XMLHttpRequest();
      req.open('GET', url);

      req.onload = () => {
        if (req.status === 200) {
          resolve(req.response);
        } else {
          reject(new Error(req.statusText));
        }
      };

      req.onerror = () => {
        reject(new Error('Network Error'));
      };

      req.send();
    });
  },
  parseHTML: string => {
    const tmp = document.implementation.createHTMLDocument('temp');
    tmp.documentElement.innerHTML = string;
    return tmp.documentElement;
  },
  isFunction: (functionName, context) => {
    const namespaces = functionName.split('.');
    const func = namespaces.pop();
    for (const k of namespaces) {
      context = context[namespaces[k]];
    }
    return typeof context[func] === 'function';
  },
  getFunction: (functionName, context) => {
    const args = [].slice.call(_arguments).splice(2);
    const namespaces = functionName.split('.');
    const func = namespaces.pop();
    for (const k of namespaces) {
      context = context[namespaces[k]];
    }
    if (context[func]) {
      return context[func].apply(context, args);
    } else {
      return false;
    }
  }
};