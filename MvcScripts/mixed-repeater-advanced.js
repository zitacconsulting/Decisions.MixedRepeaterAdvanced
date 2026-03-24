$DP = $DP || {};
$DP.Control = $DP.Control || {};

(function ($DP) {
    var Control;
    (function (Control) {

        const FLEX_LAYOUT_TYPE = "Silverdark.Designers.Forms.Containers.FlexLayout, DecisionsFramework";

        // Page-level registry of all MRA instances keyed by componentId.
        // Used so a drag-source can find accepting targets at dragstart time.
        // Exposed on window for console debugging: Object.keys(window._dpMraRegistry)
        const _registry = {};
        window._dpMraRegistry = _registry;

        class MixedRepeaterAdvanced extends Control.UserControlListContainer {
            constructor($controlLayout, options) {
                super($controlLayout, options);
                this._listEl = null;
            }

            renderhtml() {
                let section = this.userDefinedSection;
                if (this.options.isInDesignMode) {
                    section.append($('<div class="full-size flex-centering">Mixed Repeater Advanced</div>'));
                    this.$controlLayout = section;
                    return this.$controlLayout;
                }
                return super.renderhtml();
            }

            buildListItem(options) {
                const isFlexLayout = options.rootContainer.$type === FLEX_LAYOUT_TYPE;
                const isFlexHeight = isFlexLayout && options.rootContainer.flexHeightType === $DP.Containers.FlexSizeType.Flexible;
                const canDrag = this.options.dragToReorder || this.options.allowDragOut;
                const draggable = canDrag ? 'draggable="true"' : '';

                const item = $(`<div data-requested-width="${options.rootContainer.requestedWidth}"
                           ${isFlexHeight ? '' : `data-requested-height="${options.rootContainer.requestedHeight}"`}
                           data-child-id="${options.id}"
                           data-tab-order="${options.index + 1}"
                           ${draggable}
                           class="dp-udcl-child-item form-validation-settings">
                     </div>`);
                if (canDrag && this.options.showDragHandle) {
                    item.css('position', 'relative');
                    item.append('<div class="dp-mra-drag-handle" aria-hidden="true">⠿</div>');
                }
                dpComponents.Utils.ensureFormTabManagement(item[0], false);
                return item;
            }

            // Returns the element that is the direct parent of .dp-udcl-child-item nodes.
            // Cached after first computation; reset to null in initializeSurfaces so it is
            // recomputed when items are re-rendered.
            _getListEl() {
                if (this._listEl) return this._listEl;
                const firstItem = this.$control.find('.dp-udcl-child-item')[0];
                if (firstItem) {
                    this._listEl = firstItem.parentNode;
                    return this._listEl;
                }
                // Empty list — .userControlsHolder is the items container even when empty.
                // Walk up from any descendant to find it.
                const holder = this.$control.find('.userControlsHolder')[0];
                if (holder) {
                    this._listEl = holder;
                    return this._listEl;
                }
                // Last resort fallbacks
                this._listEl = this.$control.find('.dp-user-defined-control-list')[0]
                    || this.$control[0];
                return this._listEl;
            }

            // Returns true if el is, or is a descendant of, the given container.
            _isInContainer(el, container) {
                return el === container || container.contains(el);
            }

            async initializeSurfaces(childSurfacesInfo) {
                // Build childId → typeName map from raw data before super processes it.
                // ItemTypeName is PascalCase in the serialised JSON (DataContract naming).
                this._itemTypeMap = {};
                if (childSurfacesInfo) {
                    for (const entry of childSurfacesInfo) {
                        if (entry.Id && entry.ItemTypeName) {
                            this._itemTypeMap[entry.Id] = entry.ItemTypeName;
                        }
                    }
                }
                await super.initializeSurfaces(childSurfacesInfo);
                if (!this.options.isInDesignMode) {
                    // Register so other instances can find us as a cross-drag target.
                    if (this.options.componentId) {
                        _registry[this.options.componentId] = this;
                    }
                    // Reset cached listEl — items have just been (re)rendered.
                    this._listEl = null;
                    this._getListEl();

                    if (this.options.dragToReorder || this.options.allowDragOut) {
                        this._setupDrag();
                    }
                }
                return this;
            }

            _setupDrag() {
                // Remove any previously registered dragstart listener so re-renders
                // don't accumulate duplicate handlers (which would create two placeholders).
                if (this._dragStartHandler && this._dragStartListEl) {
                    this._dragStartListEl.removeEventListener('dragstart', this._dragStartHandler);
                    this._dragStartHandler = null;
                    this._dragStartListEl = null;
                }

                // Inject shared styles once per page load.
                if (!document.getElementById('dp-mra-styles')) {
                    const style = document.createElement('style');
                    style.id = 'dp-mra-styles';
                    style.textContent = [
                        '.dp-mra-dragging { opacity: 0.4; }',
                        '[draggable="true"] { cursor: grab; }',
                        // During drag, show the correct cursor based on whether the target accepts.
                        'body.dp-mra-drag-deny * { cursor: no-drop !important; }',
                        'body.dp-mra-drag-allow * { cursor: move !important; }',
                        '.dp-mra-placeholder {',
                        '  background: rgba(59,130,246,0.12);',
                        '  border: 2px dashed #3b82f6;',
                        '  border-radius: 4px;',
                        '  box-sizing: border-box;',
                        '  pointer-events: none;',
                        '}',
                        '.dp-mra-drag-handle {',
                        '  position: absolute;',
                        '  top: 50%;',
                        '  right: 6px;',
                        '  transform: translateY(-50%);',
                        '  cursor: grab;',
                        '  color: rgba(0,0,0,0.25);',
                        '  font-size: 20px;',
                        '  line-height: 1;',
                        '  user-select: none;',
                        '  z-index: 10;',
                        '  pointer-events: none;',
                        '}',
                    ].join('\n');
                    document.head.appendChild(style);
                }

                const listEl = this._getListEl();
                if (!listEl) return;

                let dragSrcEl = null;
                let placeholder = null;
                let denyBadge = null;
                // Cleanup functions registered by cross-targets during a drag.
                const crossCleanups = [];

                // ── Auto-scroll ──────────────────────────────────────────────────────
                // Walk up to find the nearest element that scrolls vertically.
                const findScrollParent = (el) => {
                    while (el && el !== document.body) {
                        const { overflow, overflowY } = getComputedStyle(el);
                        if (/auto|scroll/.test(overflow + overflowY)) return el;
                        el = el.parentElement;
                    }
                    return null; // fall back to window
                };
                const scrollParent = findScrollParent(listEl);

                const SCROLL_EDGE = 80;  // px from container edge that triggers scroll
                const SCROLL_SPEED = 16; // max px per frame

                let _scrollRAF = null;
                let _scrollClientY = 0;
                let _scrollClientX = 0;

                const _scrollTick = () => {
                    const top    = scrollParent ? scrollParent.getBoundingClientRect().top    : 0;
                    const bottom = scrollParent ? scrollParent.getBoundingClientRect().bottom : window.innerHeight;
                    const y = _scrollClientY;

                    let delta = 0;
                    if (y - top < SCROLL_EDGE)
                        delta = -Math.round(SCROLL_SPEED * (1 - (y - top) / SCROLL_EDGE));
                    else if (bottom - y < SCROLL_EDGE)
                        delta = Math.round(SCROLL_SPEED * (1 - (bottom - y) / SCROLL_EDGE));

                    if (delta !== 0) {
                        if (scrollParent) scrollParent.scrollTop += delta;
                        else window.scrollBy(0, delta);
                    }
                    _scrollRAF = requestAnimationFrame(_scrollTick);
                };

                const _stopScroll = () => {
                    if (_scrollRAF) { cancelAnimationFrame(_scrollRAF); _scrollRAF = null; }
                };

                // Walk up from the hit element to find the nearest .dp-udcl-child-item
                // that is a direct child of targetListEl.
                const itemAtPoint = (targetListEl, x, y) => {
                    if (placeholder && placeholder.parentNode) placeholder.style.display = 'none';
                    const hit = document.elementFromPoint(x, y);
                    if (placeholder && placeholder.parentNode) placeholder.style.display = '';
                    if (!hit) return null;
                    let el = hit;
                    while (el && el !== targetListEl) {
                        if (el.parentNode === targetListEl && el.classList.contains('dp-udcl-child-item')) return el;
                        el = el.parentNode;
                    }
                    return null;
                };

                // ── Global deny-all dragover (runs first in capture; shows prohibited cursor) ──
                // Accepting handlers registered after this will override dropEffect to 'move'.
                const onDragOverDenyAll = (e) => {
                    if (!dragSrcEl) return;
                    _scrollClientY = e.clientY;
                    _scrollClientX = e.clientX;
                    document.body.classList.add('dp-mra-drag-deny');
                    document.body.classList.remove('dp-mra-drag-allow');
                    if (denyBadge) {
                        denyBadge.style.left = e.clientX + 'px';
                        denyBadge.style.top  = e.clientY + 'px';
                        denyBadge.style.display = '';
                    }
                };

                // ── Same-control dragover ────────────────────────────────────────────
                const onDragOver = (e) => {
                    if (!dragSrcEl) return;
                    if (e.target !== listEl && !listEl.contains(e.target)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    document.body.classList.remove('dp-mra-drag-deny');
                    document.body.classList.add('dp-mra-drag-allow');
                    if (denyBadge) denyBadge.style.display = 'none';
                    if (!placeholder) return;

                    // If placeholder wandered into another list, bring it back.
                    if (placeholder.parentNode !== listEl) {
                        listEl.appendChild(placeholder);
                    }

                    const targetItem = itemAtPoint(listEl, e.clientX, e.clientY);
                    if (targetItem === dragSrcEl || targetItem === placeholder) return;
                    if (!targetItem) {
                        // Cursor is inside the list but not over any item (empty space below
                        // the last item) — move placeholder to the end so a last-position
                        // drop is possible.
                        listEl.appendChild(placeholder);
                        return;
                    }
                    const rect = targetItem.getBoundingClientRect();
                    if (e.clientY < rect.top + rect.height / 2) {
                        listEl.insertBefore(placeholder, targetItem);
                    } else {
                        listEl.insertBefore(placeholder, targetItem.nextSibling);
                    }
                };

                // ── Same-control drop ────────────────────────────────────────────────
                const onDrop = (e) => {
                    if (!dragSrcEl) return;
                    if (e.target !== listEl && !listEl.contains(e.target)) return;
                    e.preventDefault();

                    if (!placeholder || placeholder.parentNode !== listEl) {
                        cleanup();
                        return;
                    }

                    listEl.insertBefore(dragSrcEl, placeholder);
                    dragSrcEl.classList.remove('dp-mra-dragging');
                    placeholder.remove();
                    placeholder = null;

                    // Reorder childFormSurfaceInfo to match new DOM order.
                    const newOrder = Array.from(listEl.querySelectorAll('.dp-udcl-child-item'))
                        .map(el => el.dataset.childId);
                    this.childFormSurfaceInfo = newOrder
                        .map(id => this.childFormSurfaceInfo.find(s => s.id === id))
                        .filter(Boolean);

                    if (this.options.triggerValueChangedOnReorder) {
                        this.raiseEvent(new $DP.FormHost.DataChangedEvent());
                    }

                    cleanup();
                };

                // Animate a fixed-position ghost from the cursor back to the item.
                // Appended directly to <body> at the maximum z-index so it renders
                // above the form modal regardless of its stacking context.
                const snapBack = (item) => {
                    const rect = item.getBoundingClientRect();
                    // Ghost starts centered on the cursor, slides to the item's position.
                    const startLeft = _scrollClientX - rect.width  / 2;
                    const startTop  = _scrollClientY - rect.height / 2;
                    const dx = rect.left - startLeft;
                    const dy = rect.top  - startTop;

                    item.classList.remove('dp-mra-dragging');

                    const ghost = item.cloneNode(true);
                    ghost.style.cssText =
                        `position:fixed;left:${startLeft}px;top:${startTop}px;` +
                        `width:${rect.width}px;height:${rect.height}px;` +
                        `margin:0;z-index:2147483647;pointer-events:none;` +
                        `opacity:0.85;transform:none;transition:none;` +
                        `box-shadow:0 4px 16px rgba(0,0,0,0.2);`;
                    document.body.appendChild(ghost);

                    requestAnimationFrame(() => requestAnimationFrame(() => {
                        ghost.style.transition =
                            'transform 0.4s cubic-bezier(0.25,0.46,0.45,0.94),' +
                            'opacity 0.35s ease';
                        ghost.style.transform = `translate(${dx}px,${dy}px)`;
                        ghost.style.opacity = '0';
                    }));

                    const remove = () => {
                        if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
                        ghost.removeEventListener('transitionend', onEnd);
                    };
                    const onEnd = (e) => { if (e.propertyName === 'transform') remove(); };
                    ghost.addEventListener('transitionend', onEnd);
                    setTimeout(remove, 600);
                };

                const onDragEnd = () => {
                    // dragSrcEl is only still set when the drop was NOT handled
                    // (cancelled drag, dropped on non-accepting target, Escape key).
                    if (dragSrcEl) snapBack(dragSrcEl);
                    cleanup();
                };

                const cleanup = () => {
                    if (dragSrcEl) dragSrcEl.classList.remove('dp-mra-dragging');
                    if (placeholder && placeholder.parentNode) placeholder.remove();
                    if (denyBadge && denyBadge.parentNode) denyBadge.parentNode.removeChild(denyBadge);
                    denyBadge = null;
                    window._dpMraDenyBadge = null;
                    placeholder = null;
                    dragSrcEl = null;
                    window._dpMraDragState = null;
                    document.body.classList.remove('dp-mra-is-dragging', 'dp-mra-drag-deny', 'dp-mra-drag-allow');
                    _stopScroll();
                    document.removeEventListener('dragover', onDragOverDenyAll, true);
                    document.removeEventListener('dragover', onDragOver, true);
                    document.removeEventListener('drop', onDrop, true);
                    document.removeEventListener('dragend', onDragEnd);
                    crossCleanups.forEach(fn => fn());
                    crossCleanups.length = 0;
                };

                // ── dragstart ────────────────────────────────────────────────────────
                this._dragStartHandler = (e) => {
                    const item = e.target.closest('.dp-udcl-child-item');
                    if (!item || item.parentNode !== listEl) return;

                    dragSrcEl = item;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', item.dataset.childId);

                    // Badge that appears near the cursor to signal a denied drop.
                    // Shown by onDragOverDenyAll, hidden by accepting onDragOver handlers.
                    denyBadge = document.createElement('div');
                    denyBadge.style.cssText =
                        'position:fixed;z-index:2147483647;pointer-events:none;display:none;' +
                        'width:22px;height:22px;border-radius:50%;background:#ef4444;' +
                        'color:#fff;font-size:14px;line-height:22px;text-align:center;' +
                        'font-weight:bold;transform:translate(14px,-22px);' +
                        'box-shadow:0 1px 4px rgba(0,0,0,0.3);';
                    denyBadge.textContent = '✕';
                    document.body.appendChild(denyBadge);
                    window._dpMraDenyBadge = denyBadge;

                    placeholder = document.createElement('div');
                    placeholder.className = 'dp-mra-placeholder';
                    placeholder.style.width = item.offsetWidth + 'px';
                    placeholder.style.height = item.offsetHeight + 'px';
                    // Place placeholder immediately after the grabbed item.
                    listEl.insertBefore(placeholder, item.nextSibling);

                    // Defer opacity so the browser captures the full drag image first.
                    requestAnimationFrame(() => {
                        item.classList.add('dp-mra-dragging');
                    });

                    // Start auto-scroll loop; it reads _scrollClientY updated by onDragOverDenyAll.
                    _scrollClientY = e.clientY;
                    _scrollRAF = requestAnimationFrame(_scrollTick);

                    document.addEventListener('dragover', onDragOverDenyAll, true);
                    document.addEventListener('dragover', onDragOver, true);
                    document.addEventListener('drop', onDrop, true);
                    document.addEventListener('dragend', onDragEnd);

                    // ── Cross-control: notify accepting targets ───────────────────
                    if (this.options.allowDragOut) {
                        const itemType = (this._itemTypeMap && this._itemTypeMap[item.dataset.childId]) || '';
                        window._dpMraDragState = {
                            srcInstance: this,
                            childId: item.dataset.childId,
                            itemType,
                        };

                        const myName = this.options.componentName;
                        let activatedCount = 0;
                        Object.values(_registry).forEach(inst => {
                            if (inst === this) return;
                            const accepts = inst.options.acceptDragFrom;
                            if (!accepts || !Array.isArray(accepts)) return;
                            if (!accepts.includes(myName)) return;

                            // If the target's Sources define specific types, enforce the restriction.
                            const acceptedTypes = inst.options.mraAcceptedTypes;
                            if (acceptedTypes && acceptedTypes.length > 0 && itemType) {
                                if (!acceptedTypes.includes(itemType)) return;
                            }

                            const cleanupFn = inst._activateCrossTarget(
                                this, placeholder, item, cleanup
                            );
                            if (cleanupFn) { crossCleanups.push(cleanupFn); activatedCount++; }
                        });
                        console.log('[MRA] drag started from', myName,
                            '| registry:', Object.keys(_registry).map(id => _registry[id].options.componentName),
                            '| activated targets:', activatedCount);
                    }
                };
                this._dragStartListEl = listEl;
                listEl.addEventListener('dragstart', this._dragStartHandler);
            }

            // Called on the TARGET instance when a source that we accept starts a drag.
            // Returns a cleanup function that removes registered document listeners.
            _activateCrossTarget(srcInstance, placeholder, dragSrcEl, srcCleanup) {
                const tgtListEl = this._getListEl();
                if (!tgtListEl) return null;

                // Use the outer control element as the hit zone — much larger and more
                // reliable than tgtListEl, which can be tiny / zero-height when empty.
                const tgtHitZone = this.$control[0] || tgtListEl;

                const tgtInst = this;

                const itemAtPoint = (x, y) => {
                    if (placeholder.parentNode) placeholder.style.display = 'none';
                    const hit = document.elementFromPoint(x, y);
                    if (placeholder.parentNode) placeholder.style.display = '';
                    if (!hit) return null;
                    let el = hit;
                    while (el && el !== tgtListEl) {
                        if (el.parentNode === tgtListEl && el.classList.contains('dp-udcl-child-item')) return el;
                        el = el.parentNode;
                    }
                    return null;
                };

                const onDragOver = (e) => {
                    if (!window._dpMraDragState) return;
                    // Accept events anywhere inside the outer control wrapper.
                    if (e.target !== tgtHitZone && !tgtHitZone.contains(e.target)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    document.body.classList.remove('dp-mra-drag-deny');
                    document.body.classList.add('dp-mra-drag-allow');
                    if (window._dpMraDenyBadge) window._dpMraDenyBadge.style.display = 'none';

                    // Move placeholder into our list if it is currently elsewhere.
                    if (placeholder.parentNode !== tgtListEl) {
                        tgtListEl.appendChild(placeholder);
                    }

                    const targetItem = itemAtPoint(e.clientX, e.clientY);
                    if (targetItem === placeholder) return;
                    if (!targetItem) {
                        // Cursor is inside the target but not over any item — append to end.
                        tgtListEl.appendChild(placeholder);
                        return;
                    }
                    const rect = targetItem.getBoundingClientRect();
                    if (e.clientY < rect.top + rect.height / 2) {
                        tgtListEl.insertBefore(placeholder, targetItem);
                    } else {
                        tgtListEl.insertBefore(placeholder, targetItem.nextSibling);
                    }
                };

                const onDrop = (e) => {
                    if (!window._dpMraDragState) return;
                    if (e.target !== tgtHitZone && !tgtHitZone.contains(e.target)) return;
                    if (!placeholder || placeholder.parentNode !== tgtListEl) return;
                    e.preventDefault();

                    // Count item siblings before the placeholder to derive insertAtIndex.
                    const phIdx = Array.from(tgtListEl.children).indexOf(placeholder);
                    const insertAt = Array.from(tgtListEl.children)
                        .slice(0, phIdx)
                        .filter(el => el.classList.contains('dp-udcl-child-item'))
                        .length;

                    const childId = window._dpMraDragState.childId;

                    // Move the DOM element into the target list at the placeholder position.
                    tgtListEl.insertBefore(dragSrcEl, placeholder);
                    dragSrcEl.classList.remove('dp-mra-dragging');
                    placeholder.remove();

                    // Update childFormSurfaceInfo on both controls.
                    const srcChildInfo = srcInstance.childFormSurfaceInfo
                        ? srcInstance.childFormSurfaceInfo.find(s => s.id === childId)
                        : null;
                    if (srcInstance.childFormSurfaceInfo) {
                        srcInstance.childFormSurfaceInfo = srcInstance.childFormSurfaceInfo
                            .filter(s => s.id !== childId);
                    }
                    if (srcChildInfo && tgtInst.childFormSurfaceInfo) {
                        const updated = [...tgtInst.childFormSurfaceInfo];
                        updated.splice(insertAt, 0, srcChildInfo);
                        tgtInst.childFormSurfaceInfo = updated;
                    }

                    // Persist the move server-side.
                    const formSessionInfoId = tgtInst.options.mraFormSessionId
                        || srcInstance.options.mraFormSessionId;
                    const srcControlId = srcInstance.options.componentId;
                    const tgtControlId = tgtInst.options.componentId;

                    if (formSessionInfoId && srcControlId && tgtControlId) {
                        Decisions.callAwaitableMethod(
                            'MoveChild',
                            'MixedRepeaterAdvancedService/js/MoveChild',
                            {
                                formSessionInfoId,
                                sourceControlId: srcControlId,
                                targetControlId: tgtControlId,
                                childId,
                                insertAtIndex: insertAt,
                            }
                        ).catch(err => console.error('[MRA] MoveChild failed', err));
                    }

                    // Raise ValueChanged on both controls if configured.
                    if (srcInstance.options.triggerValueChangedOnReorder) {
                        srcInstance.raiseEvent(new $DP.FormHost.DataChangedEvent());
                    }
                    if (tgtInst.options.triggerValueChangedOnReorder) {
                        tgtInst.raiseEvent(new $DP.FormHost.DataChangedEvent());
                    }

                    cleanup();
                    srcCleanup();
                };

                const onDragEnd = () => { cleanup(); };

                const cleanup = () => {
                    document.removeEventListener('dragover', onDragOver, true);
                    document.removeEventListener('drop', onDrop, true);
                    document.removeEventListener('dragend', onDragEnd);
                    document.body.classList.remove('dp-mra-drag-deny', 'dp-mra-drag-allow');
                };

                document.addEventListener('dragover', onDragOver, true);
                document.addEventListener('drop', onDrop, true);
                document.addEventListener('dragend', onDragEnd);

                return cleanup;
            }
        }

        Control.MixedRepeaterAdvanced = MixedRepeaterAdvanced;

    })(Control = $DP.Control || ($DP.Control = {}));
})($DP || ($DP = {}));
