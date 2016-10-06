"use strict";
/**
Copyright (c) 2014 The Chromium Authors. All rights reserved.
Use of this source code is governed by a BSD-style license that can be
found in the LICENSE file.
**/

require("../../base/event.js");
require("../../base/utils.js");
require("./ui.js");
require("./utils.js");

'use strict';

/**
 * @fileoverview Implements an element that is hidden by default, but
 * when shown, dims and (attempts to) disable the main document.
 *
 * You can turn any div into an overlay. Note that while an
 * overlay element is shown, its parent is changed. Hiding the overlay
 * restores its original parentage.
 *
 */
global.tr.exportTo('tr.ui.b', function () {
  if (tr.isHeadless) return {};

  return;

  /**
   * Creates a new overlay element. It will not be visible until shown.
   * @constructor
   * @extends {HTMLDivElement}
   */
  var Overlay = tr.ui.b.define('overlay');

  Overlay.prototype = {
    __proto__: HTMLDivElement.prototype,

    /**
     * Initializes the overlay element.
     */
    decorate: function () {
      Polymer.dom(this).classList.add('overlay');

      this.parentEl_ = this.ownerDocument.body;

      this.visible_ = false;
      this.userCanClose_ = true;

      this.onKeyDown_ = this.onKeyDown_.bind(this);
      this.onClick_ = this.onClick_.bind(this);
      this.onFocusIn_ = this.onFocusIn_.bind(this);
      this.onDocumentClick_ = this.onDocumentClick_.bind(this);
      this.onClose_ = this.onClose_.bind(this);

      this.addEventListener('visible-change', tr.ui.b.Overlay.prototype.onVisibleChange_.bind(this), true);

      // Setup the shadow root
      var createShadowRoot = this.createShadowRoot || this.webkitCreateShadowRoot;
      this.shadow_ = createShadowRoot.call(this);
      Polymer.dom(this.shadow_).appendChild(tr.ui.b.instantiateTemplate('#overlay-template', THIS_DOC));

      this.closeBtn_ = Polymer.dom(this.shadow_).querySelector('close-button');
      this.closeBtn_.addEventListener('click', this.onClose_);

      Polymer.dom(this.shadow_).querySelector('overlay-frame').addEventListener('click', this.onClick_);

      this.observer_ = new WebKitMutationObserver(this.didButtonBarMutate_.bind(this));
      this.observer_.observe(Polymer.dom(this.shadow_).querySelector('button-bar'), { childList: true });

      // title is a variable on regular HTMLElements. However, we want to
      // use it for something more useful.
      Object.defineProperty(this, 'title', {
        get: function () {
          return Polymer.dom(Polymer.dom(this.shadow_).querySelector('title')).textContent;
        },
        set: function (title) {
          Polymer.dom(Polymer.dom(this.shadow_).querySelector('title')).textContent = title;
        }
      });
    },

    set userCanClose(userCanClose) {
      this.userCanClose_ = userCanClose;
      this.closeBtn_.style.display = userCanClose ? 'block' : 'none';
    },

    get buttons() {
      return Polymer.dom(this.shadow_).querySelector('button-bar');
    },

    get visible() {
      return this.visible_;
    },

    set visible(newValue) {
      if (this.visible_ === newValue) return;

      this.visible_ = newValue;
      var e = new tr.b.Event('visible-change');
      this.dispatchEvent(e);
    },

    onVisibleChange_: function () {
      this.visible_ ? this.show_() : this.hide_();
    },

    show_: function () {
      Polymer.dom(this.parentEl_).appendChild(this);

      if (this.userCanClose_) {
        this.addEventListener('keydown', this.onKeyDown_.bind(this));
        this.addEventListener('click', this.onDocumentClick_.bind(this));
        this.closeBtn_.addEventListener('click', this.onClose_);
      }

      this.parentEl_.addEventListener('focusin', this.onFocusIn_);
      this.tabIndex = 0;

      // Focus the first thing we find that makes sense. (Skip the close button
      // as it doesn't make sense as the first thing to focus.)
      var focusEl = undefined;
      var elList = Polymer.dom(this).querySelectorAll('button, input, list, select, a');
      if (elList.length > 0) {
        if (elList[0] === this.closeBtn_) {
          if (elList.length > 1) focusEl = elList[1];
        } else {
          focusEl = elList[0];
        }
      }
      if (focusEl === undefined) focusEl = this;
      focusEl.focus();
    },

    hide_: function () {
      Polymer.dom(this.parentEl_).removeChild(this);

      this.parentEl_.removeEventListener('focusin', this.onFocusIn_);

      if (this.closeBtn_) this.closeBtn_.removeEventListener('click', this.onClose_);

      document.removeEventListener('keydown', this.onKeyDown_);
      document.removeEventListener('click', this.onDocumentClick_);
    },

    onClose_: function (e) {
      this.visible = false;
      if (e.type != 'keydown' || e.type === 'keydown' && e.keyCode === 27) e.stopPropagation();
      e.preventDefault();
      tr.b.dispatchSimpleEvent(this, 'closeclick');
    },

    onFocusIn_: function (e) {
      if (e.target === this) return;

      window.setTimeout(function () {
        this.focus();
      }, 0);
      e.preventDefault();
      e.stopPropagation();
    },

    didButtonBarMutate_: function (e) {
      var hasButtons = this.buttons.children.length > 0;
      if (hasButtons) {
        Polymer.dom(this.shadow_).querySelector('button-bar').style.display = undefined;
      } else {
        Polymer.dom(this.shadow_).querySelector('button-bar').style.display = 'none';
      }
    },

    onKeyDown_: function (e) {
      // Disallow shift-tab back to another element.
      if (e.keyCode === 9 && // tab
      e.shiftKey && e.target === this) {
        e.preventDefault();
        return;
      }

      if (e.keyCode !== 27) // escape
        return;

      this.onClose_(e);
    },

    onClick_: function (e) {
      e.stopPropagation();
    },

    onDocumentClick_: function (e) {
      if (!this.userCanClose_) return;

      this.onClose_(e);
    }
  };

  Overlay.showError = function (msg, opt_err) {
    var o = new Overlay();
    o.title = 'Error';
    Polymer.dom(o).textContent = msg;
    if (opt_err) {
      var e = tr.b.normalizeException(opt_err);

      var stackDiv = document.createElement('pre');
      Polymer.dom(stackDiv).textContent = e.stack;
      stackDiv.style.paddingLeft = '8px';
      stackDiv.style.margin = 0;
      Polymer.dom(o).appendChild(stackDiv);
    }
    var b = document.createElement('button');
    Polymer.dom(b).textContent = 'OK';
    b.addEventListener('click', function () {
      o.visible = false;
    });
    Polymer.dom(o.buttons).appendChild(b);
    o.visible = true;
    return o;
  };

  return {
    Overlay: Overlay
  };
});