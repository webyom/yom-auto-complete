var $ = window.jQuery || window.$;
var listTpl = require('./list.tpl.html');
var groupListTpl = require('./group-list.tpl.html');
var richItemListTpl = require('./rich-item-list.tpl.html');
var pinyin = require('./pinyin');
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
	this._dataSource = null;
	this._selectedData = (opt.initData || []).map(function(item) {
		return self.getStdItem(item);
	});
	this._listTpl = opt.listTpl || opt.group && groupListTpl || listTpl;
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
	this.setDataSource(opt.dataSource);
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
		this._list = this._insertNode($('<div data-type="auto-complete" class="auto-complete-list"></div>').css($.extend({width: '218px', display: 'none'}, this._opt.listStyle)));
		this.setSelectedData(this._opt.initData);
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
			if($('.dropdown-menu', this._list).css('overflow-y') == 'scroll') {
				this._fixListScroll(index);
			}
			evt.preventDefault();
		} else if(keyCode === 38 && this._currentListData) {//up
			index = this._currentListIndex === 0 ? this._currentListData.length - 1 : this._currentListIndex - 1;
			this._highlightItem(index);
			if($('.dropdown-menu', this._list).css('overflow-y') == 'scroll') {
				this._fixListScroll(index);
			}
			evt.preventDefault();
		} else if(keyCode === 9) {//tab
			this.hideList();
		} else if(this._richSelectionResult && (keyCode === 8 || keyCode === 46) && this._getInputRange().end === 0) {
			var removeId = $('.active', this._richBox).attr('data-id');
			if(removeId) {
				var rmItems = this.removeSelectedItem(removeId);
				var rmStdItems = this.getStdItem(rmItems);
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
					this._syncFromDataList();
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
		$('.dropdown-menu', this._list).on('scroll', this._bind.scroll);
		this._list.delegate('li[data-index] a', 'click', function(evt) {
			var i = parseInt($(evt.target).closest('li[data-index]').attr('data-index'));
			setTimeout(function() {//make sure the blur event of input box occurs first
				self._selectItem(i);
			}, 0);
		}).delegate('li[data-index] a', 'mouseover', function(evt) {
			self._highlightItem(parseInt($(this).closest('li[data-index]').attr('data-index')));
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
				var id = $(this).closest('.auto-complete-rich-item').attr('data-id');
				setTimeout(function() {//make sure the click event on document.body occurs before the item removed
					var rmItems = self.removeSelectedItem(id);
					if(self._checkbox) {
						$('[data-id="' + id + '"] .auto-complete-mockup-checkbox', self._list).removeClass('on');
					} else {
						self.hideList();
					}
					var rmStdItems = self.getStdItem(rmItems);
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
		$('.dropdown-menu', this._list).off('scroll', this._bind.scroll);
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
		return $.trim(this._separator).replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&');
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
		var dropdown = $('.dropdown-menu', this._list);
		item = $('[data-index="' + index + '"]', dropdown);
		if(!item.length) {
			return;
		}
		itemHeight = item.outerHeight();
		itemPos = item.position();
		listHeight = dropdown.outerHeight();
		listScrollTop = dropdown.prop('scrollTop');
		if(listHeight < itemPos.top + itemHeight) {
			dropdown.prop('scrollTop', itemHeight + itemPos.top + listScrollTop - listHeight);
		} else if(itemPos.top < 0) {
			dropdown.prop('scrollTop', listScrollTop + itemPos.top);
		}
	},

	_fixBoxPadding: function() {
		if(!this._richBox || !this._box[0].clientWidth) {
			return;
		}
		var lastRichItem = $('.auto-complete-rich-item:last', this._richBox)[0];
		var itemOffset, boxOffset, left, top, textRange, val;
		if(!this._box.data('initWidth')) {
			this._richBox.css({marginRight: '30px'});
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

	_syncFromDataList: function() {
		if(this._freeInput) {
			return;
		}
		var nameList = [];
		if(this._richSelectionResult) {
			this._richBox.html(this._richItemListTpl.render({
				list: this._selectedData,
				maxWidth: this._box.innerWidth() - 40
			}, {
				getRichItemText: this._opt.getRichItemText
			}));
			this._fixBoxPadding();
			this._checkPlaceHolder();
		} else {
			$.each(this._selectedData, function(i, item) {
				nameList.push(item.name);
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
		var onRemove = this._opt.onRemove;
		if(nameList.length) {
			nameList[nameList.length - 1] = this._getToBeMatchedInput();
		}
		$.each(this._selectedData, function(i, item) {
			var inBox = false;
			$.each(nameList, function(j, name) {
				if($.trim(item.name) == $.trim(name)) {
					inBox = true;
					dataList.push(item);
					return false;
				}
			});
			if(!inBox) {
				rmItems.push(item);
			}
		});
		this._selectedData = dataList;
		if(onRemove && rmItems.length) {
			onRemove.call(this._box[0], rmItems);
		}
	},

	/**
	 * @returns {Boolean} added
	 */
	_addItem: function(aItem) {
		if(this._freeInput) {
			return true;
		}
		var item;
		var hasSame = false;
		var onRemove = this._opt.onRemove;
		if(this._selectedData.length >= this._maxSelection) {
			if(this._maxSelection === 1) {
				item = this._selectedData[0];
				if(aItem.id == item.id) {
					return false;
				} else {
					this._selectedData = [aItem];
					if(onRemove) {
						onRemove.call(this._box[0], [item]);
					}
					return true;
				}
			} else {
				return false;
			}
		}
		$.each(this._selectedData, function(i, item) {
			if(aItem.id == item.id) {
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
		var inputLowerCase = input.toLowerCase();
		var iGroup, iName;
		if(inputLowerCase.indexOf(':') === 0) {
			inputLowerCase = inputLowerCase.split(':');
			iGroup = inputLowerCase[1];
			iName = inputLowerCase.slice(2).join(':');
		} else {
			iName = inputLowerCase;
		}
		var matchedList = [];
		if(this._dataSource) {
			$.each(this._dataSource, function(i, item) {
				if(matchedList.length >= self._listMaxLength) {
					return false;
				}
				var hasSame = false;
				var matched;
				if(iGroup && item._group) {
					matched = item._group.toLowerCase().indexOf(iGroup) >= 0;
					if(!matched && item._groupPinyinFull != item._group) {
						matched = item._groupPinyinFull.toLowerCase().indexOf(iGroup) >= 0;
					}
					if(!matched && item._groupPinyinLead != item._group) {
						matched = item._groupPinyinLead.toLowerCase().indexOf(iGroup) >= 0;
					}
				}
				if(!iGroup || matched && iName) {
					matched = item.name && item.name.toLowerCase().indexOf(iName) >= 0;
					if(!matched && item._pinyinFull != item.name) {
						matched = item._pinyinFull.toLowerCase().indexOf(iName) >= 0;
					}
					if(!matched && item._pinyinLead != item.name) {
						matched = item._pinyinLead.toLowerCase().indexOf(iName) >= 0;
					}
					if(!matched && item._summary) {
						matched = item._summary.replace(/ - /g, '').toLowerCase().indexOf(iName) >= 0;
					}
				}
				if(matched) {
					if(self._excludeExist) {
						$.each(self._dataSource, function(j, item2) {
							if(item.id == item2.id) {
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
			if(this._opt.getMatchedList) {
				this._opt.getMatchedList(input, callback, matchedList);
			} else if(callback) {
				callback(matchedList, input);
			} else {
				this.renderList(matchedList, {matchedInput: iName});
			}
		} else if(this._opt.getMatchedList) {
			this._opt.getMatchedList(input, callback);
		}
	},

	_selectItem: function(index) {
		var self = this;
		var onBeforeSelect = this._opt.onBeforeSelect;
		var onSelect = this._opt.onSelect;
		var onRemove = this._opt.onRemove;
		var item, checkbox, added;
		if(!(index >= 0 && this._currentListData && typeof this._currentListData[index] != 'undefined')) {
			return;
		}
		item = this._currentListData[index];
		if(this._checkbox) {
			checkbox = $('[data-id="' + item.id + '"] .auto-complete-mockup-checkbox', this._list);
		}
		if(checkbox && checkbox.length) {
			this._cancelBlurHide();
			if(checkbox.hasClass('on')) {
				this.removeSelectedItem(item);
				checkbox.removeClass('on');
				onRemove && onRemove.call(this._box[0], [item]);
			} else {
				if(!onBeforeSelect || onBeforeSelect.call(this._box[0], item, index) !== false) {
					added = this._addItem(item);
					if(added && !this._richSelectionResult) {
						this._box.val(this._trimr() + item.name + (this._maxSelection > 1 ? this._separator : ''));
						this._syncFromBox();
					} else {
						this._syncFromDataList();
					}
					if(added) {
						checkbox.addClass('on');
						onSelect && onSelect.call(this._box[0], item, index);
					}
				}
			}
		} else {
			if(!onBeforeSelect || onBeforeSelect.call(this._box[0], item, index) !== false) {
				added = this._addItem(item);
				if(added && !this._richSelectionResult) {
					this._box.val(this._trimr() + item.name + (this._maxSelection > 1 ? this._separator : ''));
					this._syncFromBox();
				} else {
					this._syncFromDataList();
				}
				this.hideList();
				added && onSelect && onSelect.call(this._box[0], item, index);
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
		var matchedInput = opt.matchedInput || '';
		var isFullList = opt.isFullList;
		var noResultMsg = opt.noResultMsg || this._opt.noResultMsg || 'No Matches';
		var autoSelect = opt.autoSelect || this._opt.autoSelect;
		var filteredList, listLen;
		if(dataList && dataList.length) {
			if(this._hasAnyOtherListShown()) {
				return;
			}
			if(this._excludeExist && !isFullList) {
				filteredList = [];
				$.each(dataList, function(i, item) {
					var hasSame = false;
					item = self.getStdItem(item);
					$.each(self._selectedData, function(j, item2) {
						if(item.id == item2.id) {
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
				this._currentListData = dataList.map(function(item) {
					return self.getStdItem(item);
				});
			}
			listLen = this._currentListData.length;
			if(listLen) {
				this._list.html(listTpl.render({
					list: this._currentListData,
					matchedInput: matchedInput,
					checkbox: this._checkbox,
					selectedData: this._selectedData,
					noResultMsg: noResultMsg
				}, {
					getListItemText: this._opt.getListItemText
				})).show();
				var dropdown = $('.dropdown-menu', this._list);
				if(dropdown.height() > this._listMaxHeight) {
					dropdown.css({
						'overflow-y': 'scroll',
						'height': this._listMaxHeight + 'px'
					});
				}
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

	getStdItem: function(item) {
		if(item == undefined || item._std) {
			return item;
		} if(this._opt.getStdItem) {
			item = this._opt.getStdItem(item);
			item._std = true;
			return item;
		} else {
			if(typeof item == 'string') {
				return {
					id: item,
					name: item,
					_std: true
				};
			} else {
				item.id = item.id || item.name;
				item.name = item.name || item.id;
				item._std = true;
				return item;
			}
		}
	},

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
		if(this._opt.renderFullList) {
			return this._opt.renderFullList(excludeExist);
		}
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
			$.each(this._selectedData, function(i, item) {
				res.push(getItem(item));
			});
		} else {
			res = this._selectedData.concat();
		}
		return res;
	},

	getSelectedPropList: function(prop) {
		var res = [];
		this._syncFromDataList();
		$.each(this._selectedData, function(i, item) {
			res.push(item[prop]);
		});
		return res;
	},

	setSelectedData: function(dataList) {
		var self = this;
		if(this._dataSource && dataList && this._opt.mustSelectInDataSource !== false) {
			this._selectedData = this._dataSource.filter(function(item) {
				return dataList.some(function(initItem) {
					var stdInitItem = self.getStdItem(initItem);
					if(stdInitItem.id == item.id) {
						return true;
					}
					return false;
				});
			});
		} else {
			this._selectedData = (dataList || []).map(function(item) {
				return self.getStdItem(item);
			});
		}
		this._syncFromDataList();
	},

	setDataSource: function(dataSource) {
		var self = this;
		if (this._opt.group && dataSource) {
			var tmp = [];
			var keys = Object.keys(dataSource);
			$.each(keys, function(i, key) {
				var group = dataSource[key];
				if(self._opt.getStdGroupItem) {
					group = self._opt.getStdGroupItem(group, key);
				}
				group.data = group.data || [];
				$.each(group.data, function(j, item) {
					var stdItem = self.getStdItem(item);
					stdItem._group = group.name || key;
					stdItem._groupPinyinFull = stdItem._groupPinyinFull || pinyin.getFullChars(stdItem._group);
					stdItem._groupPinyinLead = stdItem._groupPinyinLead || pinyin.getCamelChars(stdItem._group);
					tmp.push(stdItem);
				});
			});
			dataSource = tmp;
		}
		if(dataSource && dataSource.length >= 0) {
			this._dataSource = dataSource.map(function(item) {
				var stdItem = self.getStdItem(item);
				if(!stdItem._summary && self._opt.summaryKeys) {
					var summary = [];
					$.each(self._opt.summaryKeys, function(i, key) {
						if(item[key] && typeof item[key] == 'string') {
							summary.push(item[key]);
						}
					});
					stdItem._summary = summary.join(' - ');
				}
				if(stdItem._summary) {
					var summary = stdItem._summary.replace(/ - /g, '');
					stdItem._pinyinFull = stdItem._pinyinFull || pinyin.getFullChars(summary);
					stdItem._pinyinLead = stdItem._pinyinLead || pinyin.getCamelChars(summary);
				} else if(stdItem.name) {
					stdItem._pinyinFull = stdItem._pinyinFull || pinyin.getFullChars(stdItem.name);
					stdItem._pinyinLead = stdItem._pinyinLead || pinyin.getCamelChars(stdItem.name);
				} else {
					stdItem._pinyinFull = '';
					stdItem._pinyinLead = '';
				}
				return stdItem;
			});
		}
	},

	addSelectedItem: function(aItem) {
		if(!aItem) {
			return false;
		}
		var res;
		var validItem = false;
		var aItem = this.getStdItem(aItem);
		if(this._dataSource) {
			$.each(this._dataSource, function(i, item) {
				if(aItem.id == item.id) {
					aItem = item;
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
			$.each(this._selectedData, function(i, item) {
				if(item.id == rItem) {
					rItem = item;
					return false;
				}
			});
		}
		var res = null;
		var i, item;
		for(i = this._selectedData.length - 1; i >= 0; i--) {
			item = this._selectedData[i];
			if(item.id == rItem.id) {
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

YomAutoComplete.pinyin = pinyin;

module.exports = YomAutoComplete;
