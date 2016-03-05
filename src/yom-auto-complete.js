var $ = window.jQuery || window.$;
var listTpl = require('./list.tpl.html');
var richItemListTpl = require('./rich-item-list.tpl.html');
require('./yom-auto-complete.less');

var YomAutoComplete = function(box, opt) {
	var self = this;
	opt = opt || {};
	this._opt = opt;
	this._box = $(box);
	this._richBox = null;
	this._list = null;
	this._maxSelection = opt.maxSelection > 0 ? parseInt(opt.maxSelection) : 9999;
	this._listMaxLength = opt.listMaxLength > 0 ? opt.listMaxLength : 10;
	this._listMaxHeight = opt.listMaxHeight > 0 ? opt.listMaxHeight : 260;
	this._freeInput = !!opt.freeInput;
	this._richSelectionResult = !opt.freeInput && opt.richSelectionResult;
	this._richItemListTpl = opt.richItemListTpl || richItemListTpl;
	this._separator = opt.separator || (this._richSelectionResult ? '' : '; ');
	this._excludeExist = !!opt.excludeExist;
	this._checkbox = this._maxSelection > 1 && !this._excludeExist && !this._freeInput;
	this._dataSource = opt.dataSource;
	this._selectedData = opt.initData || [];
	this._getStdItem = opt.getStdItem;
	this._listTpl = opt.listTpl || listTpl;
	this._listTplData = opt.listTplData || {};
	this._previousListData = null;
	this._currentListData = null;
	this._currentListIndex = 0;
	this._toRefMatch = null;
	this._toRefFocus = null;
	this._toRefBlurHide = null;
	this._bind = {
		click: function(evt) {return self._onClick(evt);},
		focus: function(evt) {return self._onFocus(evt);},
		blur: function(evt) {return self._onBlur(evt);},
		keydown: function(evt) {return self._onKeydown(evt);},
		keypress: function(evt) {return self._onKeypress(evt);},
		keyup: function(evt) {return self._onKeyup(evt);},
		scroll: function(evt) {return self._cancelBlurHide();}
	};
	this._init();
};

$.extend(YomAutoComplete.prototype, {
	_insertNode: function(node) {
		var boxSibling = this._box.next();
		if(boxSibling.length) {
			return node.insertBefore(boxSibling);
		} else {
			return node.appendTo(this._box.parent());
		}
	},

	_init: function() {
		this._box.parent().css('position') == 'static' && this._box.parent().css('position', 'relative');
		if(this._richSelectionResult) {
			this._richBox = this._insertNode($('<div data-type="auto-complete-rich-box" class="clearfix"></div>').css($.extend({position: 'absolute', left: '0', top: '0'}, this._opt.richBoxStyle)));
		}
		this._list = this._insertNode($('<ul data-type="auto-complete" class="typeahead dropdown-menu"></ul>').css($.extend({width: '218px', display: 'none'}, this._opt.listStyle)));
		this._syncFromDataList();
		this._bindEvent();
	},

	_onClick: function(evt) {
		if(this._richBox) {
			$('.auto-complete-rich-item', this._richBox).removeClass('active');
		}
		if((!this._opt.onClick || this._opt.onClick.call(this._box[0], evt) !== false) && !this.isListShown()) {
			this.showFullList(this._excludeExist);
		}
	},

	_onFocus: function(evt) {
		var self = this;
		clearTimeout(this._toRefBlurHide);
		if(this._richSelectionResult) {
			this._fixBoxPadding();
		} else {
			this._syncFromDataList();
		}
		this._toRefFocus = setTimeout(function() {
			self._moveInputEnd();
		}, 100);
		if((!this._opt.onFocus || this._opt.onFocus.call(this._box[0], evt) !== false) && !this.isListShown()) {
			this.showFullList(this._excludeExist);
		}
	},

	_onBlur: function(evt) {
		var self = this;
		clearTimeout(this._toRefFocus);
		this._toRefBlurHide = setTimeout(function() {
			self._syncFromDataList();
			self.hideList();
		}, 500);
		if(this._opt.onBlur) {
			this._opt.onBlur.call(this._box[0], evt);
		}
	},

	_onKeydown: function(evt) {
		var keyCode = evt.keyCode;
		if(keyCode === 40 && this._currentListData) {//down
			var index = (this._currentListIndex + 1) % this._currentListData.length;
			this._highlightItem(index);
			if(this._list.css('overflow-y') == 'scroll') {
				this._fixListScroll(index);
			}
			evt.preventDefault();
		} else if(keyCode === 38 && this._currentListData) {//up
			index = this._currentListIndex === 0 ? this._currentListData.length - 1 : this._currentListIndex - 1;
			this._highlightItem(index);
			if(this._list.css('overflow-y') == 'scroll') {
				this._fixListScroll(index);
			}
			evt.preventDefault();
		} else if(keyCode === 9) {//tab
			this.hideList();
		} else if(this._richSelectionResult && (keyCode === 8 || keyCode === 46) && this._getInputRange().end === 0) {
			var removeId = $('.active', this._richBox).data('id');
			if(removeId) {
				var rmItems = this.removeSelectedItem(removeId);
				var getStdItem = this._getStdItem;
				var rmStdItems = getStdItem ? getStdItem(rmItems) : rmItems;
				var onRemove = this._opt.onRemove;
				if(this._checkbox) {
					$('[data-id="' + removeId + '"] .auto-complete-mockup-checkbox', this._list).removeClass('on');
				}
				onRemove && onRemove.call(this._box[0], rmItems, rmStdItems);
			} else {
				$('.auto-complete-rich-item:last', this._richBox).addClass('active');
			}
			this._checkbox || this.hideList();
		}
		if(this._opt.onKeydown) {
			this._opt.onKeydown.call(this._box[0], evt);
		}
	},

	_onKeypress: function(evt) {
		var keyCode = evt.keyCode;
		if(keyCode === 13) {//enter
			evt.preventDefault();
			this.isListShown() && evt.stopPropagation();
		}
	},

	_onKeyup: function(evt) {
		if(!this._box) {
			return;
		}
		var self = this;
		var keyCode = evt.keyCode;
		var boxValue = this._box.val();
		var toBeMatchedInput;
		clearTimeout(this._toRefMatch);
		if(keyCode === 13) {//enter
			if(this.isListShown()) {
				evt.stopPropagation();
				this._selectItem(this._currentListIndex);
			}
		} else if(keyCode === 27) {//esc
			this.hideList();
		} else if((keyCode === 8 || keyCode === 46 || keyCode === 88 && evt.ctrlKey) && !this._richSelectionResult && boxValue.split(new RegExp('\\s*' + this._getRegExpSeperator() + '\\s*')).length <= this._selectedData.length) {//backspace/delete/ctrl + x
			this._syncFromBox();
			this.hideList();
		} else if(!(keyCode >= 37 && keyCode <= 40) && keyCode !== 9/*tab*/ && keyCode !== 17/*ctrl*/ && !evt.ctrlKey) {
			toBeMatchedInput = this._getToBeMatchedInput();
			if(toBeMatchedInput && !this._opt.disableFilter) {
				this._toRefMatch = setTimeout(function() {
					self._getMatchedList(toBeMatchedInput);
				}, 300);
			} else {
				if(!(keyCode === 8 || keyCode === 46) && !this._freeInput && this._separator && new RegExp(this._getRegExpSeperator() + '\\s*$').test(boxValue)) {
					this._syncFromDataList(true);
					if(!this._checkbox || !$('[data-index="' + this._currentListIndex + '"] .auto-complete-mockup-checkbox', this._list).hasClass('on')) {
						this._selectItem(this._currentListIndex);
					}
				} else if(keyCode !== 9) {//tab
					if(this._checkbox) {
						this.showFullList();
					} else {
						this.hideList();
					}
				}
			}
		} else if(evt.keyCode === 40 && !this.isListShown()) {
			this.showFullList(this._excludeExist);
		}
		if(this._opt.onKeyup) {
			this._opt.onKeyup.call(this._box[0], evt);
		}
	},

	_bindEvent: function() {
		var self = this;
		this._box
			.on('click', this._bind.click)
			.on('focus', this._bind.focus)
			.on('blur', this._bind.blur)
			.on('keydown', this._bind.keydown)
			.on('keypress', this._bind.keypress)
			.on('keyup', this._bind.keyup);
		this._list.on('scroll', this._bind.scroll);
		this._list.delegate('li[data-index] a', 'click', function(evt) {
			var i = parseInt($(evt.target).closest('li[data-index]').data('index'));
			setTimeout(function() {//make sure the blur event of input box occurs first
				self._selectItem(i);
			}, 0);
		}).delegate('li[data-index] a', 'mouseover', function(evt) {
			self._highlightItem(parseInt($(this).closest('li[data-index]').data('index')));
		});
		if(this._richBox) {
			this._richBox.delegate('.auto-complete-rich-box-list', 'click', function(evt) {
				self._box[0].focus();
				if(!$(evt.target).closest('.auto-complete-rich-item').length) {
					$('.auto-complete-rich-item', this._richBox).removeClass('active');
				}
			}).delegate('.auto-complete-rich-item', 'click', function(evt) {
				$('.auto-complete-rich-item', self._richBox).removeClass('active');
				$(this).addClass('active');
			}).delegate('.icon-remove', 'click', function(evt) {
				var id = $(this).closest('.auto-complete-rich-item').data('id');
				setTimeout(function() {//make sure the click event on document.body occurs before the item removed
					var rmItems = self.removeSelectedItem(id);
					if(self._checkbox) {
						$('[data-id="' + id + '"] .auto-complete-mockup-checkbox', self._list).removeClass('on');
					} else {
						self.hideList();
					}
					var getStdItem = self._getStdItem;
					var rmStdItems = getStdItem ? getStdItem(rmItems) : rmItems;
					var onRemove = self._opt.onRemove;
					onRemove && onRemove.call(self._box[0], rmItems, rmStdItems);
				}, 0);
			});
		}
	},

	_unbindEvent: function() {
		this._box
			.off('click', this._bind.click)
			.off('focus', this._bind.focus)
			.off('blur', this._bind.blur)
			.off('keydown', this._bind.keydown)
			.off('keypress', this._bind.keypress)
			.off('keyup', this._bind.keyup);
		this._list.off('scroll', this._bind.scroll);
		this._list.undelegate();
		if(this._richBox) {
			this._richBox.undelegate();
		}
	},

	_cancelBlurHide: function() {
		var self = this;
		if(this._toRefBlurHide) {
			clearTimeout(this._toRefBlurHide);
			this._toRefBlurHide = null;
			$(document).on('click', function bodyClickHide(evt) {
				if(self._box.parent().find($(evt.target).closest('[data-type^="auto-complete"]')).length) {
					return;
				}
				$(document).off('click', bodyClickHide);
				if(evt.target != self._box[0]) {
					self._syncFromDataList();
					self.hideList();
				}
			});
		}
	},

	_getRegExpSeperator: function() {
		return $.trim(this._separator).replace(/([\.\|\[\]\(\)\{\}\\])/g, '\\$1');
	},

	_getInputRange: function() {
		var inputBox = this._box[0];
		var rangeData = {text: '', start: 0, end: 0};
		var range, initRange;
		inputBox.focus();
		if(inputBox.setSelectionRange) {
			rangeData.start = inputBox.selectionStart;
			rangeData.end = inputBox.selectionEnd;
			rangeData.text = inputBox.value.substring(rangeData.start, rangeData.end);
		} else if(document.selection) {
			initRange = document.selection.createRange();
			range = document.selection.createRange();
			rangeData.text = range.text;
			inputBox.select();
			range.setEndPoint('StartToStart', document.selection.createRange());
			rangeData.end = range.text.length;
			rangeData.start = rangeData.end - rangeData.text.length;
			initRange.select();
		}
		return rangeData;
	},

	_moveInputEnd: function() {
		var boxEl = this._box.get(0);
		var textRange;
		if(boxEl.createTextRange) {
			textRange = boxEl.createTextRange();
			textRange.moveStart('character', boxEl.value.length);
			textRange.collapse(true);
			textRange.select();
		} else {
			boxEl.setSelectionRange(boxEl.value.length, boxEl.value.length);
		}
	},

	_fixListScroll: function(index) {
		var item, itemHeight, itemPos, listHeight, listScrollTop;
		item = $('[data-index="' + index + '"]', this._list);
		if(!item.length) {
			return;
		}
		itemHeight = item.outerHeight();
		itemPos = item.position();
		listHeight = this._list.innerHeight();
		listScrollTop = this._list.prop('scrollTop');
		if(listHeight < itemPos.top + itemHeight) {
			this._list.prop('scrollTop', itemHeight + itemPos.top + listScrollTop - listHeight);
		} else if(itemPos.top < 0) {
			this._list.prop('scrollTop', listScrollTop + itemPos.top);
		}
	},

	_each: function(dataList, callback) {
		var getStdItem = this._getStdItem;
		$.each(dataList, function(i, item) {
			if(!item) {
				return true;
			}
			var stdItem = getStdItem ? getStdItem(item) : item;
			return callback(i, item, stdItem);
		});
	},

	_fixBoxPadding: function(focus) {
		if(!this._richBox || !this._box[0].clientWidth) {
			return;
		}
		var lastRichItem = $('.auto-complete-rich-item:last', this._richBox)[0];
		var itemOffset, boxOffset, left, top, textRange, val;
		if(!this._box.data('initWidth')) {
			this._richBox.css({maxWidth: (this._box.innerWidth() - 30) + 'px'});
			this._box.data('initWidth', this._box.outerWidth());
			this._box.data('initHeight', this._box.outerHeight());
			this._box.data('initPaddingLeft', parseInt(this._box.css('padding-left')) || 0);
			this._box.data('initPaddingTop', parseInt(this._box.css('padding-top')) || 0);
		}
		if(lastRichItem) {
			itemOffset = $(lastRichItem).offset();
			boxOffset = this._richBox.offset();
			left = Math.max(itemOffset.left - boxOffset.left + $(lastRichItem).outerWidth() + 2, this._box.data('initPaddingLeft'));
			top = Math.max(itemOffset.top - boxOffset.top + 2, this._box.data('initPaddingTop'));
			if(this._box.css('box-sizing') == 'border-box') {
				this._box.css({
					paddingLeft: left + 'px',
					paddingTop: top + 'px',
					width: this._box.data('initWidth') + 'px',
					height: top > 16 ? (this._box.data('initHeight') + top - 4 + 'px') : (this._box.data('initHeight') + 'px')
				});
			} else {
				this._box.css({
					paddingLeft: left + 'px',
					paddingTop: top + 'px',
					width: (this._box.data('initWidth') - left + this._box.data('initPaddingLeft')) + 'px'
				});
			}
		} else {
			if(this._box.css('box-sizing') == 'border-box') {
				this._box.css({
					paddingLeft: this._box.data('initPaddingLeft') + 'px',
					paddingTop: this._box.data('initPaddingTop') + 'px',
					width: this._box.data('initWidth') + 'px',
					height: this._box.data('initHeight') + 'px'
				});
			} else {
				this._box.css({
					paddingLeft: this._box.data('initPaddingLeft') + 'px',
					paddingTop: this._box.data('initPaddingTop') + 'px',
					width: this._box.data('initWidth') + 'px'
				});
			}
		}
		if(focus && this._box[0].createTextRange) {//IE
			val = this._box.val();
			this._box.val(' ');
			textRange = this._box[0].createTextRange();
			textRange.collapse(false);
			textRange.select();
			this._box.val(val);
		}
	},

	_checkPlaceHolder: function() {
		var placeholder = this._box.data('placeholder');
		if(!placeholder) {
			this._box.data('placeholder', this._box.attr('placeholder'));
		}
		if(this._selectedData.length) {
			this._box.attr('placeholder', '');
		} else {
			this._box.attr('placeholder', placeholder);
		}
	},

	_syncFromDataList: function(focus) {
		if(this._freeInput) {
			return;
		}
		var nameList = [];
		if(this._richSelectionResult) {
			this._richBox.html(this._richItemListTpl.render({
				list: this._selectedData,
				maxWidth: this._box.innerWidth() - 40
			}, {
				getStdItem: this._getStdItem,
				getRichItemText: this._opt.getRichItemText
			}));
			this._fixBoxPadding(focus);
			this._checkPlaceHolder();
		} else {
			this._each(this._selectedData, function(i, item, stdItem) {
				nameList.push(stdItem.name);
			});
			if(nameList.length) {
				if(nameList.length > 1 || this._maxSelection > 1) {
					this._box.val(nameList.join(this._separator) + this._separator);
				} else {
					this._box.val(nameList[0]);
				}
			} else {
				this._box.val('');
			}
		}
	},

	_syncFromBox: function() {
		if(this._freeInput) {
			return;
		}
		var nameList = this._box.val().split(new RegExp('\\s*' + this._getRegExpSeperator() + '\\s*'));
		var dataList = [];
		var rmItems = [];
		var rmStdItems = [];
		var onRemove = this._opt.onRemove;
		if(nameList.length) {
			nameList[nameList.length - 1] = this._getToBeMatchedInput();
		}
		this._each(this._selectedData, function(i, item, stdItem) {
			var inBox = false;
			$.each(nameList, function(j, name) {
				if($.trim(stdItem.name) == $.trim(name)) {
					inBox = true;
					dataList.push(item);
					return false;
				}
			});
			if(!inBox) {
				rmItems.push(item);
				rmStdItems.push(stdItem);
			}
		});
		this._selectedData = dataList;
		if(onRemove && rmItems.length) {
			onRemove.call(this._box[0], rmItems, rmStdItems);
		}
	},

	/**
	 * @returns {Boolean} added
	 */
	_addItem: function(aItem) {
		if(this._freeInput) {
			return true;
		}
		var getStdItem = this._getStdItem;
		var aStdItem = getStdItem ? getStdItem(aItem) : aItem;
		var item, stdItem;
		var hasSame = false;
		var onRemove = this._opt.onRemove;
		if(this._selectedData.length >= this._maxSelection) {
			if(this._maxSelection === 1) {
				item = this._selectedData[0];
				stdItem = getStdItem ? getStdItem(item) : item;
				if(aStdItem.id == stdItem.id) {
					return false;
				} else {
					this._selectedData = [aItem];
					if(onRemove) {
						onRemove.call(this._box[0], [item], [stdItem]);
					}
					return true;
				}
			} else {
				return false;
			}
		}
		this._each(this._selectedData, function(i, item, stdItem) {
			if(aStdItem.id == stdItem.id) {
				hasSame = true;
				return false;
			}
		});
		if(hasSame) {
			return false;
		}
		this._selectedData.push(aItem);
		return true;
	},

	_trimr: function() {
		var tmp = this._box.val().split(new RegExp('\\s*' + this._getRegExpSeperator() + '\\s*'));
		tmp.pop();
		return tmp.length ? tmp.join(this._separator) + this._separator : '';
	},

	_getToBeMatchedInput: function() {
		var tmp, res;
		if(this._separator) {
			tmp = this._box.val().split(new RegExp('\\s*' + this._getRegExpSeperator() + '\\s*'));
		} else {
			tmp = [this._box.val()];
		}
		res = $.trim(tmp.pop());
		if(!res) {
			return '';
		}
		tmp = $.trim(this._separator);
		for(var i = res.length; i > 0; i--) {
			if(tmp.indexOf(res.slice(-i)) === 0) {
				res = res.slice(0, res.length - i);
				break;
			}
		}
		return $.trim(res);
	},

	_getMatchedList: function(input, callback) {
		var self = this;
		var matchedList = [];
		if(this._opt.getMatchedList) {
			this._opt.getMatchedList(input, callback);
		} else if(this._dataSource) {
			this._each(this._dataSource, function(i, item, stdItem) {
				var hasSame = false;
				if(matchedList.length >= self._listMaxLength) {
					return false;
				}
				if(stdItem.name.toLowerCase().indexOf(input.toLowerCase()) >= 0) {
					if(self._excludeExist) {
						self._each(self._selectedData, function(j, item2, stdItem2) {
							if(stdItem.id == stdItem2.id) {
								hasSame = true;
								return false;
							}
						});
						if(!hasSame) {
							matchedList.push(item);
						}
					} else {
						matchedList.push(item);
					}
				}
			});
			if(callback) {
				callback(matchedList, input);
			} else {
				this.renderList(matchedList, {matchedInput: input});
			}
		}
	},

	_selectItem: function(index) {
		var self = this;
		var onBeforeSelect = this._opt.onBeforeSelect;
		var onSelect = this._opt.onSelect;
		var onRemove = this._opt.onRemove;
		var item, stdItem, checkbox, added;
		if(!(index >= 0 && this._currentListData && typeof this._currentListData[index] != 'undefined')) {
			return;
		}
		item = this._currentListData[index];
		stdItem = this._getStdItem ? this._getStdItem(item) : item;
		if(this._checkbox) {
			checkbox = $('[data-index="' + index + '"] .auto-complete-mockup-checkbox', this._list);
		}
		if(checkbox && checkbox.length) {
			this._cancelBlurHide();
			if(checkbox.hasClass('on')) {
				this.removeSelectedItem(item);
				checkbox.removeClass('on');
				onRemove && onRemove.call(this._box[0], [item], [stdItem]);
			} else {
				if(!onBeforeSelect || onBeforeSelect.call(this._box[0], item, stdItem, index) !== false) {
					added = this._addItem(item);
					if(added && !this._richSelectionResult) {
						this._box.val(this._trimr() + stdItem.name + (this._maxSelection > 1 ? this._separator : ''));
						this._syncFromBox();
					} else {
						this._syncFromDataList(true);
					}
					if(added) {
						checkbox.addClass('on');
						onSelect && onSelect.call(this._box[0], item, stdItem, index);
					}
				}
			}
		} else {
			if(!onBeforeSelect || onBeforeSelect.call(this._box[0], item, stdItem, index) !== false) {
				added = this._addItem(item);
				if(added && !this._richSelectionResult) {
					this._box.val(this._trimr() + stdItem.name + (this._maxSelection > 1 ? this._separator : ''));
					this._syncFromBox();
				} else {
					this._syncFromDataList(true);
				}
				this.hideList();
				added && onSelect && onSelect.call(this._box[0], item, stdItem, index);
			}
		}
	},

	_highlightItem: function(index) {
		if(index >= 0 && typeof this._currentListData[index] != 'undefined') {
			$('[data-index]', this._list).removeClass('active');
			$('[data-index="' + index + '"]', this._list).addClass('active');
			this._currentListIndex = index;
		}
	},

	_hasAnyOtherListShown: function() {
		return !this.isListShown() && !!$('[data-type="auto-complete"]:visible', this._box.parent()).length;
	},

	_renderList: function(dataList, opt) {
		opt = opt || {};
		var self = this;
		var listTpl = opt.listTpl || this._listTpl;
		var listTplData = opt.listTplData || this._listTplData;
		var matchedInput = opt.matchedInput || '';
		var isFullList = opt.isFullList;
		var noResultMsg = opt.noResultMsg || this._opt.noResultMsg || 'No Matches';
		var autoSelect = opt.autoSelect || this._opt.autoSelect;
		var filteredList, listLen;
		this._list.css({
			'overflow-x': 'hidden',
			'overflow-y': 'hidden',
			'height': 'auto'
		});
		if(dataList && dataList.length) {
			if(this._hasAnyOtherListShown()) {
				return;
			}
			if(this._excludeExist && !isFullList) {
				filteredList = [];
				this._each(dataList, function(i, item, stdItem) {
					var hasSame = false;
					self._each(self._selectedData, function(j, item2, stdItem2) {
						if(stdItem.id == stdItem2.id) {
							hasSame = true;
							return false;
						}
					});
					if(!hasSame) {
						filteredList.push(item);
					}
				});
				this._currentListData = filteredList;
			} else {
				this._currentListData = dataList;
			}
			listLen = this._currentListData.length;
			if(listLen) {
				this._list.html(listTpl.render($.extend(listTplData, {
					list: this._currentListData,
					matchedInput: matchedInput,
					checkbox: this._checkbox,
					selectedData: this._selectedData
				}), {
					getStdItem: this._getStdItem,
					getListItemText: this._opt.getListItemText
				}));
				if(this._list.height() > this._listMaxHeight) {
					this._list.css({
						'overflow-y': 'scroll',
						'height': this._listMaxHeight + 'px'
					});
				}
				this._list.show();
				this._highlightItem(0);
				this._fixListScroll(0);
				if(listLen === 1 && autoSelect) {
					this._selectItem(0);
				}
			} else {
				this._list.html(listTpl.render({
					list: [],
					noResultMsg: noResultMsg
				}, {})).show();
			}
		} else if(dataList && !this._hasAnyOtherListShown() && (this._opt.noResultMsg !== '' || opt.noResultMsg) && (!this._freeInput || opt.noResultMsg)) {
			this._currentListData = [];
			this._list.html(listTpl.render({
				list: [],
				noResultMsg: noResultMsg
			}, {})).show();
		} else {//hide
			this._previousListData = this._currentListData;
			this._currentListData = null;
			this._list.html('').hide();
		}
		this._currentListIndex = 0;
		return this;
	},

	//Public

	renderPreviousList: function(opt) {
		if(this._previousListData && this._previousListData.length) {
			this._renderList(this._previousListData, opt);
		}
		return this;
	},

	renderList: function(dataList, opt) {
		if(dataList && dataList.length) {
			dataList = dataList.slice(0, this._listMaxLength);
		}
		this._renderList(dataList, opt);
		return this;
	},

	hideList: function() {
		if(this.isListShown() && (!this._opt.onBeforeHide || this._opt.onBeforeHide.call(this._box[0]) !== false)) {
			this._renderList();
			if(this._richSelectionResult) {
				this._box.val('');
			}
		}
	},

	showFullList: function(excludeExist) {
		var dataSource = this._dataSource;
		if(dataSource) {
			this._renderList(dataSource, {isFullList: !excludeExist});
		}
		return this;
	},

	isListShown: function() {
		return !!this._currentListData;
	},

	getSelectedDataList: function(getItem) {
		var res = [];
		this._syncFromDataList();
		if(typeof getItem == 'function') {
			this._each(this._selectedData, function(i, item, stdItem) {
				res.push(getItem(item, stdItem));
			});
		} else {
			res = this._selectedData.concat();
		}
		return res;
	},

	getSelectedPropList: function(prop, raw) {
		var res = [];
		this._syncFromDataList();
		this._each(this._selectedData, function(i, item, stdItem) {
			res.push(raw ? item[prop] : stdItem[prop]);
		});
		return res;
	},

	setSelectedData: function(dataList) {
		this._selectedData = dataList || [];
		this._syncFromDataList();
	},

	setDataSource: function(dataSource) {
		if(dataSource && dataSource.length >= 0) {
			this._dataSource = dataSource;
		}
	},

	setListTpl: function(listTpl) {
		if(listTpl) {
			this._listTpl = listTpl;
		}
	},

	setListTplData: function(listTplData) {
		if(listTplData) {
			this._listTplData = listTplData;
		}
	},

	addSelectedItem: function(aItem) {
		if(!aItem) {
			return false;
		}
		var res;
		var validItem = false;
		var getStdItem = this._getStdItem;
		var aStdItem = getStdItem ? getStdItem(aItem) : aItem;
		if(this._dataSource) {
			this._each(this._dataSource, function(i, item, stdItem) {
				if(aStdItem.id == stdItem.id) {
					aItem = item;
					aStdItem = stdItem;
					validItem = true;
					return false;
				}
			});
		}
		if(!validItem) {
			return false;
		}
		res = this._addItem(aItem);
		if(res) {
			this._syncFromDataList();
		}
		return res;
	},

	removeSelectedItem: function(rItem) {
		if(!rItem || !this._selectedData.length) {
			return null;
		}
		if(typeof rItem != 'object') {
			this._each(this._selectedData, function(i, item, stdItem) {
				if(stdItem.id == rItem) {
					rItem = item;
					return false;
				}
			});
		}
		var res = null;
		var getStdItem = this._getStdItem;
		var rStdItem = getStdItem ? getStdItem(rItem) : rItem;
		var i, stdItem;
		for(i = this._selectedData.length - 1; i >= 0; i--) {
			stdItem = getStdItem ? getStdItem(this._selectedData[i]) : this._selectedData[i];
			if(stdItem.id == rStdItem.id) {
				res = this._selectedData.splice(i, 1)[0];
			}
		}
		if(res) {
			this._syncFromDataList();
		}
		return res;
	},

	match: function(input, callback) {
		var toBeMatchedInput = input || this._getToBeMatchedInput();
		if(toBeMatchedInput && !this._opt.disableFilter) {
			this._getMatchedList(toBeMatchedInput, callback);
		}
	},

	clear: function() {
		this.hideList();
		this._previousListData = null;
		this._currentListData = null;
		this._currentListIndex = 0;
		this._selectedData = [];
		this._freeInput || this._box.val('');
		if(this._richBox) {
			this._richBox.html('');
			this._fixBoxPadding();
		}
	},

	destroy: function() {
		clearTimeout(this._toRefBlurHide);
		this.clear();
		this._unbindEvent();
		this._richBox && this._richBox.remove();
		this._list.remove();
		this._box = null;
		this._richBox = null;
		this._list = null;
	}
});

module.exports = YomAutoComplete;
