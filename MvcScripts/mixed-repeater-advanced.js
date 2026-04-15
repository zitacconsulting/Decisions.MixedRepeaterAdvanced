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
                // Selection state
                this._selectedItemId  = null;
                this._selectedItemIds = [];
                // Cached click-handler references for cleanup on re-render.
                this._selClickHandler = null;
                this._selListEl       = null;
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

            // Called by the framework whenever the server pushes updated ClientData.
            // Read paging totals and selection state BEFORE super calls initializeSurfaces
            // so visuals are correct on the very first data load.
            async setValueAsync(data) {
                if (this.options.enablePaging && this.options.pageSize > 0 && data) {
                    const pgEntry = Enumerable.from(data)
                        .firstOrDefault(d => d.name === '_mra_total_pages', null);
                    const itEntry = Enumerable.from(data)
                        .firstOrDefault(d => d.name === '_mra_total_items', null);
                    if (pgEntry != null && pgEntry.value != null) this._totalPages = pgEntry.value;
                    if (itEntry != null && itEntry.value != null) this._totalItems = itEntry.value;
                }
                if (this.options.allowSelection && data) {
                    const selEntry = Enumerable.from(data)
                        .firstOrDefault(d => d.name === this.options.componentId + '_selectedRowId', null);
                    if (selEntry != null) this._selectedItemId = selEntry.value || null;

                    const selsEntry = Enumerable.from(data)
                        .firstOrDefault(d => d.name === this.options.componentId + '_selectedRowIds', null);
                    if (selsEntry != null && selsEntry.value) {
                        this._selectedItemIds = selsEntry.value.split(',').filter(Boolean);
                    } else if (selsEntry != null) {
                        this._selectedItemIds = [];
                    }
                }
                const result = await super.setValueAsync(data);
                // Apply visuals after initializeSurfaces has rendered the new DOM.
                if (this.options.allowSelection) this._applySelectionVisuals();
                return result;
            }

            // Override getValue/getValueAsync to include selection state so the
            // server's ClientData setter updates _selectedItemId on every form cycle.
            getValue() {
                const result = super.getValue() || [];
                if (this.options.allowSelection) {
                    const d1 = new $DP.FormHost.DecisionsControlData();
                    d1.name  = this.options.componentId + '_selectedRowId';
                    d1.value = this._selectedItemId || null;
                    result.push(d1);
                    if (this.options.allowMultiSelect) {
                        const d2 = new $DP.FormHost.DecisionsControlData();
                        d2.name  = this.options.componentId + '_selectedRowIds';
                        d2.value = (this._selectedItemIds || []).join(',');
                        result.push(d2);
                    }
                }
                return result;
            }

            async getValueAsync() {
                const result = await super.getValueAsync();
                if (this.options.allowSelection) {
                    const d1 = new $DP.FormHost.DecisionsControlData();
                    d1.name  = this.options.componentId + '_selectedRowId';
                    d1.value = this._selectedItemId || null;
                    result.push(d1);
                    if (this.options.allowMultiSelect) {
                        const d2 = new $DP.FormHost.DecisionsControlData();
                        d2.name  = this.options.componentId + '_selectedRowIds';
                        d2.value = (this._selectedItemIds || []).join(',');
                        result.push(d2);
                    }
                }
                return result;
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

                    // ── Paging ────────────────────────────────────────────────
                    if (this.options.enablePaging && this.options.pageSize > 0) {
                        // Initialise page state once; subsequent calls preserve the
                        // values updated by _goToPage so the bar shows the right page.
                        if (this._currentPage === undefined) {
                            this._currentPage = this.options.pageIndex || 0;
                        }
                        if (this._totalPages === undefined) {
                            // Fallback for the initial empty-children render only.
                            // setValueAsync populates _totalPages with the real count before
                            // any subsequent call here, so this branch is rarely taken.
                            this._totalPages = 1;
                        }
                        if (this._totalItems === undefined) {
                            this._totalItems = 0;
                        }
                        // Remove stale bar injected by a previous render.
                        if (this._paginationBar && this._paginationBar.parentNode) {
                            this._paginationBar.parentNode.removeChild(this._paginationBar);
                        }
                        this._renderPagination();
                        // Fall through — drag can coexist with paging.
                    }

                    if (this.options.dragToReorder || this.options.allowDragOut) {
                        this._setupDrag();
                    }

                    if (this.options.allowSelection) {
                        this._setupSelection();
                    }
                }
                return this;
            }

            // ── Pagination ────────────────────────────────────────────────────

            _renderPagination() {
                if (!document.getElementById('dp-mra-pg-styles')) {
                    const s = document.createElement('style');
                    s.id = 'dp-mra-pg-styles';
                    s.textContent = [
                        // Bar sticks to the bottom of the scroll container so it is
                        // always visible regardless of how far the list is scrolled.
                        '.dp-mra-pagination {',
                        '  position:sticky;bottom:0;z-index:10;',
                        '  display:flex;align-items:center;justify-content:flex-end;',
                        '  gap:8px;padding:4px 8px;',
                        '  background:#fff;border-top:1px solid #e5e7eb;',
                        '}',
                        '.dp-mra-pg-info { font-size:12px;color:#6b7280;white-space:nowrap; }',
                        '.dp-mra-pg-group { display:flex;align-items:center; }',
                        '.dp-mra-pg-btn {',
                        '  min-width:24px;height:24px;padding:0 4px;',
                        '  border:1px solid #d1d5db;margin-left:-1px;',
                        '  background:#fff;cursor:pointer;',
                        '  display:inline-flex;align-items:center;justify-content:center;',
                        '  transition:background 0.1s;user-select:none;',
                        '  color:#6b7280;font-size:12px;position:relative;',
                        '}',
                        '.dp-mra-pg-group .dp-mra-pg-btn:first-child { border-radius:3px 0 0 3px;margin-left:0; }',
                        '.dp-mra-pg-group .dp-mra-pg-btn:last-child  { border-radius:0 3px 3px 0; }',
                        '.dp-mra-pg-btn:hover:not(:disabled):not(.dp-mra-pg-active) { background:#f3f4f6;z-index:1; }',
                        '.dp-mra-pg-btn:disabled { opacity:0.3;cursor:default; }',
                        '.dp-mra-pg-active { background:#f3f4f6;font-weight:600;cursor:default;z-index:1;border-color:#9ca3af; }',
                        '.dp-mra-pg-btn img { width:13px;height:13px;display:block;pointer-events:none;opacity:0.6; }',
                        '.dp-mra-pg-btn:disabled img { opacity:0.25; }',
                    ].join('\n');
                    document.head.appendChild(s);
                }

                const bar = document.createElement('div');
                bar.className = 'dp-mra-pagination';
                this._paginationBar = bar;
                this._fillPaginationBar();

                // Append inside the scroll container so sticky positioning works.
                const container = this.$control[0] || this._getListEl()?.parentNode;
                if (container) container.appendChild(bar);
            }

            // Returns the array of 0-based page indices to show as numbered buttons.
            // Always shows up to 5 consecutive pages centred on the current page.
            _getPageWindow() {
                const total = this._totalPages || 1;
                const cur   = this._currentPage || 0;
                const win   = 5;
                if (total <= win) return Array.from({length: total}, (_, i) => i);
                let start = Math.max(0, cur - Math.floor(win / 2));
                if (start + win > total) start = total - win;
                return Array.from({length: win}, (_, i) => start + i);
            }

            // Rebuilds the bar's DOM content from the current state variables.
            _fillPaginationBar() {
                const bar = this._paginationBar;
                if (!bar) return;
                bar.innerHTML = '';

                const cur   = this._currentPage || 0;
                const total = this._totalPages  || 1;
                const ps    = this.options.pageSize || 0;
                const ti    = this._totalItems  || 0;

                // "Showing X–Y of Z" — same muted colour as the page numbers
                if (ps > 0 && ti > 0) {
                    const first = cur * ps + 1;
                    const last  = Math.min((cur + 1) * ps, ti);
                    const info  = document.createElement('span');
                    info.className   = 'dp-mra-pg-info';
                    info.textContent = `Showing ${first}\u2013${last} of ${ti}`;
                    bar.appendChild(info);
                }

                // All nav + page-number buttons sit in one connected group (no gaps).
                const group = document.createElement('div');
                group.className = 'dp-mra-pg-group';

                const imgPath = base => '../Content/Images/Report/' + base;

                const imgBtn = (icon, title, targetPage, disabled) => {
                    const b = document.createElement('button');
                    b.className = 'dp-mra-pg-btn';
                    b.disabled  = disabled;
                    b.title     = title;
                    const img = document.createElement('img');
                    img.src = imgPath(icon);
                    img.alt = title;
                    b.appendChild(img);
                    if (!disabled) b.addEventListener('click', () => this._goToPage(targetPage));
                    return b;
                };

                const numBtn = (page, active) => {
                    const b = document.createElement('button');
                    b.className   = 'dp-mra-pg-btn' + (active ? ' dp-mra-pg-active' : '');
                    b.textContent = String(page + 1);
                    b.disabled    = active;
                    if (!active) b.addEventListener('click', () => this._goToPage(page));
                    return b;
                };

                group.appendChild(imgBtn('icon-pager-start.png', 'First',    0,         cur <= 0));
                group.appendChild(imgBtn('icon-pager-prev.png',  'Previous', cur - 1,   cur <= 0));

                for (const p of this._getPageWindow()) {
                    group.appendChild(numBtn(p, p === cur));
                }

                group.appendChild(imgBtn('icon-pager-next.png', 'Next',  cur + 1,   cur >= total - 1));
                group.appendChild(imgBtn('icon-pager-end.png',  'Last',  total - 1, cur >= total - 1));

                bar.appendChild(group);
            }

            async _goToPage(pageIndex) {
                if (pageIndex < 0 || pageIndex >= this._totalPages) return;
                // Optimistic update so the bar reflects the new page immediately,
                // even if initializeSurfaces fires before the await resolves.
                this._currentPage = pageIndex;
                this._updatePaginationBar();

                try {
                    const result = await Decisions.callAwaitableMethod(
                        'GoToPage',
                        'MixedRepeaterAdvancedService/js/GoToPage',
                        {
                            formSessionInfoId: this.options.mraFormSessionId,
                            controlId:         this.options.componentId,
                            pageIndex,
                        }
                    );
                    if (result) {
                        // ApiMiddleware uses DefaultContractResolver → PascalCase property names.
                        this._currentPage = result.PageIndex;
                        this._totalPages  = result.TotalPageCount;
                        this._totalItems  = result.TotalItemCount;
                        this._updatePaginationBar();
                    }
                } catch (err) {
                    console.error('[MRA] GoToPage failed', err);
                }
            }

            _updatePaginationBar() {
                this._fillPaginationBar();
            }

            // ── Selection ─────────────────────────────────────────────────────

            // Indicator type constants (mirror SelectionIndicatorType C# enum).
            static get SEL_NONE()        { return 0; }
            static get SEL_VISUAL()      { return 1; }
            static get SEL_LINE_NUMBER() { return 2; }
            static get SEL_HIGHLIGHT()   { return 3; }

            _getSelectionColorCss() {
                const c = this.options.selectionColor;
                if (!c) return '#3b82f6';
                // Use the framework's ColorStyleHelpers which correctly converts
                // any DesignerColor format (named, hex, rgba) and applies opacity.
                try {
                    return $DP.ColorDialogEditor.ColorStyleHelpers.getColor(c);
                } catch (_) {
                    return c.colorName || c.ColorName || '#3b82f6';
                }
            }

            _isSelected(childId) {
                if (!childId) return false;
                if (this.options.allowMultiSelect)
                    return (this._selectedItemIds || []).includes(childId);
                return this._selectedItemId === childId;
            }

            _setupSelection() {
                // Inject styles once per page.
                if (!document.getElementById('dp-mra-sel-styles')) {
                    const s = document.createElement('style');
                    s.id = 'dp-mra-sel-styles';
                    s.textContent = [
                        '.dp-mra-sel-highlight { background-color: var(--mra-sel-color, #dbeafe) !important; }',
                        '.dp-mra-sel-bar {',
                        '  position:absolute;left:0;top:0;bottom:0;',
                        '  width:var(--mra-ind-w,4px);',
                        '  pointer-events:none;transition:opacity 0.15s;',
                        '}',
                        '.dp-mra-line-num-wrap { display:flex;align-items:stretch; }',
                        '.dp-mra-line-num {',
                        '  display:flex;align-items:center;justify-content:center;',
                        '  min-width:28px;padding:0 4px;flex-shrink:0;',
                        '  font-size:12px;cursor:pointer;user-select:none;',
                        '  background:var(--mra-line-bg,#f3f4f6);',
                        '  color:#6b7280;transition:background 0.15s,color 0.15s;',
                        '}',
                        '.dp-mra-line-num.dp-mra-sel-active {',
                        '  background:var(--mra-sel-color,#3b82f6) !important;color:#fff;',
                        '}',
                    ].join('\n');
                    document.head.appendChild(s);
                }

                // Push CSS variables for configurable color/width.
                const el = this.$control[0];
                if (el) {
                    el.style.setProperty('--mra-sel-color', this._getSelectionColorCss());
                    el.style.setProperty('--mra-ind-w', (this.options.indicatorWidth || 4) + 'px');
                }

                // Remove stale listener from previous render.
                if (this._selClickHandler && this._selListEl) {
                    this._selListEl.removeEventListener('click', this._selClickHandler);
                    this._selClickHandler = null;
                }

                const listEl = this._getListEl();
                if (!listEl) return;

                this._selClickHandler = (e) => {
                    const item = e.target.closest('.dp-udcl-child-item');
                    if (!item || item.parentNode !== listEl) return;
                    const childId = item.dataset.childId;
                    if (!childId) return;

                    if (this.options.allowMultiSelect) {
                        const idx = (this._selectedItemIds || []).indexOf(childId);
                        if (idx === -1) {
                            this._selectedItemIds = [...(this._selectedItemIds || []), childId];
                        } else {
                            this._selectedItemIds = this._selectedItemIds.filter((_, i) => i !== idx);
                        }
                        this._selectedItemId = childId; // track last-touched for line number
                    } else {
                        // Toggle: click selected row to deselect.
                        this._selectedItemId = (this._selectedItemId === childId) ? null : childId;
                    }

                    this._applySelectionVisuals();
                    this.raiseEvent(new $DP.FormHost.SelectionChangedEvent());
                };
                this._selListEl = listEl;
                listEl.addEventListener('click', this._selClickHandler);
            }

            _applySelectionVisuals() {
                const listEl = this._getListEl();
                if (!listEl) return;

                const type = this.options.selectionIndicatorType || MixedRepeaterAdvanced.SEL_NONE;
                const items = Array.from(listEl.querySelectorAll('.dp-udcl-child-item'));

                items.forEach((item, idx) => {
                    const childId    = item.dataset.childId;
                    const isSelected = this._isSelected(childId);

                    // ── HighlightRow ─────────────────────────────────────────
                    item.classList.toggle(
                        'dp-mra-sel-highlight',
                        isSelected && type === MixedRepeaterAdvanced.SEL_HIGHLIGHT
                    );

                    // ── VisualIndicator ──────────────────────────────────────
                    let bar = item.querySelector('.dp-mra-sel-bar');
                    if (type === MixedRepeaterAdvanced.SEL_VISUAL) {
                        if (!bar) {
                            bar = document.createElement('div');
                            bar.className = 'dp-mra-sel-bar';
                            bar.style.backgroundColor = this._getSelectionColorCss();
                            item.style.position = 'relative';
                            item.appendChild(bar);
                        }
                        bar.style.opacity = isSelected ? '1' : '0.15';
                    } else if (bar) {
                        bar.remove();
                        item.style.position = '';
                    }

                    // ── LineNumber ───────────────────────────────────────────
                    let lineNum = item.querySelector('.dp-mra-line-num');
                    if (type === MixedRepeaterAdvanced.SEL_LINE_NUMBER) {
                        if (!lineNum) {
                            // Wrap the item's existing content and prepend the number cell.
                            item.classList.add('dp-mra-line-num-wrap');
                            lineNum = document.createElement('div');
                            lineNum.className = 'dp-mra-line-num';
                            item.insertBefore(lineNum, item.firstChild);
                        }
                        lineNum.textContent = String(idx + 1);
                        lineNum.classList.toggle('dp-mra-sel-active', isSelected);
                    } else if (lineNum) {
                        lineNum.remove();
                        item.classList.remove('dp-mra-line-num-wrap');
                    }
                });
            }

            // ── Drag ──────────────────────────────────────────────────────────

            _setupDrag() {
                // Remove any previously registered dragstart listener so re-renders
                // don't accumulate duplicate handlers (which would create two placeholders).
                if (this._dragStartHandler && this._dragStartListEl) {
                    this._dragStartListEl.removeEventListener('dragstart', this._dragStartHandler);
                    this._dragStartHandler = null;
                    this._dragStartListEl = null;
                }

                // Inject drag styles once per page load.
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
                // When multi-select is active and the dragged item is selected, this
                // holds all DOM items being moved together (in their original DOM order).
                let multiDragItems = null;
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

                    if (multiDragItems) {
                        // Insert all selected items before the placeholder in their
                        // original relative order, then remove them from dragging state.
                        multiDragItems.forEach(el => {
                            el.classList.remove('dp-mra-dragging');
                            listEl.insertBefore(el, placeholder);
                        });
                    } else {
                        listEl.insertBefore(dragSrcEl, placeholder);
                        dragSrcEl.classList.remove('dp-mra-dragging');
                    }
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
                    if (multiDragItems) {
                        multiDragItems.forEach(el => el.classList.remove('dp-mra-dragging'));
                        multiDragItems = null;
                    } else if (dragSrcEl) {
                        dragSrcEl.classList.remove('dp-mra-dragging');
                    }
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

                    // ── Multi-select drag detection ──────────────────────────────
                    // If the grabbed item is selected and there are multiple selections,
                    // move all selected items together.
                    multiDragItems = null;
                    if (this.options.allowMultiSelect && this._isSelected(item.dataset.childId)
                            && (this._selectedItemIds || []).length > 1) {
                        const allItems = Array.from(listEl.querySelectorAll('.dp-udcl-child-item'));
                        const selected = allItems.filter(el => this._isSelected(el.dataset.childId));
                        if (selected.length > 1) multiDragItems = selected;
                    }

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
                    if (multiDragItems) {
                        // Placeholder spans the combined height of all selected items
                        // and shows a count so the user knows what is being moved.
                        const totalH = multiDragItems.reduce((h, el) => h + el.offsetHeight, 0);
                        placeholder.style.height = totalH + 'px';
                        placeholder.style.display = 'flex';
                        placeholder.style.alignItems = 'center';
                        placeholder.style.justifyContent = 'center';
                        placeholder.style.fontSize = '12px';
                        placeholder.style.color = '#3b82f6';
                        placeholder.style.fontWeight = '600';
                        placeholder.textContent = `${multiDragItems.length} items`;
                    } else {
                        placeholder.style.height = item.offsetHeight + 'px';
                    }
                    // Place placeholder immediately after the grabbed item.
                    listEl.insertBefore(placeholder, item.nextSibling);

                    // Defer opacity so the browser captures the full drag image first.
                    requestAnimationFrame(() => {
                        (multiDragItems || [item]).forEach(el => el.classList.add('dp-mra-dragging'));
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
                        const childIds = multiDragItems
                            ? multiDragItems.map(el => el.dataset.childId)
                            : null;
                        const itemType = (this._itemTypeMap && this._itemTypeMap[item.dataset.childId]) || '';
                        window._dpMraDragState = {
                            srcInstance: this,
                            childId: item.dataset.childId,
                            childIds,   // null for single-item drags
                            itemType,
                        };

                        const myName = this.options.componentName;
                        let activatedCount = 0;
                        Object.values(_registry).forEach(inst => {
                            if (inst === this) return;
                            const accepts = inst.options.acceptDragFrom;
                            if (!accepts || !Array.isArray(accepts)) return;
                            if (!accepts.includes(myName)) return;

                            // If the target enforces type restrictions, every dragged item
                            // must pass; reject the whole batch if any one fails.
                            const acceptedTypes = inst.options.mraAcceptedTypes;
                            if (acceptedTypes && acceptedTypes.length > 0) {
                                const draggedIds = childIds || [item.dataset.childId];
                                const allAccepted = draggedIds.every(id => {
                                    const t = (this._itemTypeMap && this._itemTypeMap[id]) || '';
                                    return !t || acceptedTypes.includes(t);
                                });
                                if (!allAccepted) return;
                            }

                            const cleanupFn = inst._activateCrossTarget(
                                this, placeholder, item, cleanup
                            );
                            if (cleanupFn) { crossCleanups.push(cleanupFn); activatedCount++; }
                        });
                        console.log('[MRA] drag started from', myName,
                            '| registry:', Object.keys(_registry).map(id => _registry[id].options.componentName),
                            '| activated targets:', activatedCount,
                            multiDragItems ? `| multi (${multiDragItems.length} items)` : '');
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

                    // Count item siblings before the placeholder to derive the
                    // page-relative insert position.
                    const phIdx = Array.from(tgtListEl.children).indexOf(placeholder);
                    const insertAt = Array.from(tgtListEl.children)
                        .slice(0, phIdx)
                        .filter(el => el.classList.contains('dp-udcl-child-item'))
                        .length;

                    // When the target has paging the visible items start at
                    // pageIndex × pageSize, so we must offset to get the absolute
                    // position inside the full Children collection.
                    const tgtPageOffset = (tgtInst.options.enablePaging && tgtInst.options.pageSize > 0 && tgtInst._currentPage)
                        ? tgtInst._currentPage * tgtInst.options.pageSize
                        : 0;
                    const absoluteInsertAt = tgtPageOffset + insertAt;

                    const childId  = window._dpMraDragState.childId;
                    const childIds = window._dpMraDragState.childIds; // null for single-item drag
                    const isMulti  = childIds && childIds.length > 1;

                    // Optimistic DOM update — the server push will re-render the
                    // correct page for paged controls shortly after.
                    if (isMulti) {
                        // Gather source items in their current DOM order, then move
                        // them all to the target list in front of the placeholder.
                        const srcListEl = srcInstance._getListEl();
                        const srcItems  = Array.from(
                            srcListEl ? srcListEl.querySelectorAll('.dp-udcl-child-item') : []
                        ).filter(el => childIds.includes(el.dataset.childId));
                        srcItems.forEach(el => {
                            el.classList.remove('dp-mra-dragging');
                            tgtListEl.insertBefore(el, placeholder);
                        });
                    } else {
                        tgtListEl.insertBefore(dragSrcEl, placeholder);
                        dragSrcEl.classList.remove('dp-mra-dragging');
                    }
                    placeholder.remove();

                    // Update childFormSurfaceInfo on both controls.
                    if (isMulti) {
                        const srcInfos = childIds
                            .map(id => srcInstance.childFormSurfaceInfo?.find(s => s.id === id))
                            .filter(Boolean);
                        if (srcInstance.childFormSurfaceInfo) {
                            srcInstance.childFormSurfaceInfo = srcInstance.childFormSurfaceInfo
                                .filter(s => !childIds.includes(s.id));
                        }
                        if (tgtInst.childFormSurfaceInfo) {
                            const updated = [...tgtInst.childFormSurfaceInfo];
                            updated.splice(insertAt, 0, ...srcInfos);
                            tgtInst.childFormSurfaceInfo = updated;
                        }
                    } else {
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
                    }

                    // Persist the move server-side. For paged controls the server
                    // will push a NewFormDataEvent so each control re-renders its
                    // current page with the correct items.
                    const formSessionInfoId = tgtInst.options.mraFormSessionId
                        || srcInstance.options.mraFormSessionId;
                    const srcControlId = srcInstance.options.componentId;
                    const tgtControlId = tgtInst.options.componentId;

                    if (formSessionInfoId && srcControlId && tgtControlId) {
                        if (isMulti) {
                            Decisions.callAwaitableMethod(
                                'MoveChildren',
                                'MixedRepeaterAdvancedService/js/MoveChildren',
                                {
                                    formSessionInfoId,
                                    sourceControlId: srcControlId,
                                    targetControlId: tgtControlId,
                                    childIds,
                                    insertAtIndex: absoluteInsertAt,
                                }
                            ).catch(err => console.error('[MRA] MoveChildren failed', err));
                        } else {
                            Decisions.callAwaitableMethod(
                                'MoveChild',
                                'MixedRepeaterAdvancedService/js/MoveChild',
                                {
                                    formSessionInfoId,
                                    sourceControlId: srcControlId,
                                    targetControlId: tgtControlId,
                                    childId,
                                    insertAtIndex: absoluteInsertAt,
                                }
                            ).catch(err => console.error('[MRA] MoveChild failed', err));
                        }
                    }

                    // For non-paged controls raise ValueChanged so Decisions rules
                    // fire. Paged controls are refreshed by the server push from
                    // MoveChild, so raising here would cause a redundant re-render.
                    if (srcInstance.options.triggerValueChangedOnReorder
                            && !(srcInstance.options.enablePaging && srcInstance.options.pageSize > 0)) {
                        srcInstance.raiseEvent(new $DP.FormHost.DataChangedEvent());
                    }
                    if (tgtInst.options.triggerValueChangedOnReorder
                            && !(tgtInst.options.enablePaging && tgtInst.options.pageSize > 0)) {
                        tgtInst.raiseEvent(new $DP.FormHost.DataChangedEvent());
                    }

                    // Raise row lifecycle events so form rules react immediately.
                    if (typeof $DP.FormHost.RowRemovedEvent !== 'undefined')
                        srcInstance.raiseEvent(new $DP.FormHost.RowRemovedEvent());
                    if (typeof $DP.FormHost.RowAddedEvent !== 'undefined')
                        tgtInst.raiseEvent(new $DP.FormHost.RowAddedEvent());

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
