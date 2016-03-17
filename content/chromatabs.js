/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Chromatabs.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Justin Dolske <dolske@mozilla.com> (Original Author)
 *  Gary Calpo <gcalpo@gmail.com> (Updated to work w/ Firefox 4.0)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */
var CHROMATABS_SS  = Components.classes["@mozilla.org/browser/sessionstore;1"].getService(Components.interfaces.nsISessionStore);

var CHROMATABS = {

    _logService  : null,
    _debug       : null,
    _prefs       : null,
    _canvas      : null,

    _colorMode   : null,
    _hashFallback : null,

	// 2.3.0: New settings

	_hueTolerance: 5,  // pixel B's hue can be off by X% from pixel A but still count towards  pixel A's tally in icon-color-frequency mode

    lastSelectedTab   : null,


    /*
     * log
     *
     * Log debug messages to the Javascript console.
     * Note: javascript.options.showInConsole must be enabled
     */
    log : function (message) {
        if (!this._debug) { return; }
        this._logService.logStringMessage("Chromatabs: " + message);
    },


   /*
    * _locationListener
    *
    * Installed on each tab so we know when the URL changes.
    */
    _locationListener : {
        QueryInterface : function (aIID) {
                if (aIID.equals(Components.interfaces.nsIWebProgressListener) ||
                    aIID.equals(Components.interfaces.nsISupportsWeakReference) ||
                    aIID.equals(Components.interfaces.nsISupports))
                        return this;
                throw Components.results.NS_NOINTERFACE;
        },

        onLocationChange : function (aProgress, aRequest, aURI) {

		var doc = aProgress.DOMWindow.document;
		var tab = gBrowser.mTabs[gBrowser.getBrowserIndexForDocument(doc)];

		var oldLocation = tab.getAttribute("x-chromatabs-lastLocation");
		var newLocation = CHROMATABS.getHostnameForTab(tab);
		tab.setAttribute("x-chromatabs-lastLocation", newLocation);
		CHROMATABS.log("location change: " + newLocation);

		// Avoid recolorizing the tab if we didn't change sites (which would hash the same).
		// The same site could have different favicons, but if we're using those the
		// onLinkiconAvailable code will handle changes.
		if (newLocation != oldLocation) {
			CHROMATABS.colorizeTab(tab, false);
		}
        },

        onLinkIconAvailable: function(aBrowser) {
		CHROMATABS.log("onLinkIcon...");
		if (CHROMATABS._colorMode != "icon" && CHROMATABS._colorMode != "icon-frequency" && CHROMATABS._colorMode != "icon-average") { return; }

		var doc = aBrowser.contentDocument;
		var tab = gBrowser.mTabs[gBrowser.getBrowserIndexForDocument(doc)];

		// Whenever a page loads, we always seem to be called once with no icon (throbber?),
		// and then again with an icon. If we navigate to a page without a favicon, we'll rely
		// on onLocationChange to reset the tab color.
		var newIcon = CHROMATABS.getFaviconURL(tab);
		if (!newIcon) { return; }

		var oldIcon = tab.getAttribute("x-chromatabs-lastIcon");
		tab.setAttribute("x-chromatabs-lastIcon", newIcon);

		if (newIcon != oldIcon) {
			CHROMATABS.colorizeTab(tab, false);
		}
	},

        // unused stubs
        onStateChange:       function() { return 0; },
        onProgressChange:    function() { return 0; },
        onStatusChange:      function() { return 0; },
        onSecurityChange:    function() { return 0; }
    },


    /*
     * _prefObserver
     */
    _prefObserver : {

	QueryInterface : function (iid) {
		const interfaces = [Ci.nsIObserver, Ci.nsISupports, Ci.nsISupportsWeakReference];
		if (!interfaces.some( function(v) { return iid.equals(v) } ))
			throw Components.results.NS_ERROR_NO_INTERFACE;
		return this;
	},

	observe : function (subject, topic, data) {
		if (topic != "nsPref:changed") { throw "Woah, unexpected observer invocation."; }
		// One of our prefs changes. We'll just be lazy and set them all.
		CHROMATABS._debug        = CHROMATABS._prefs.getBoolPref("debug");
	    CHROMATABS._colorMode    = CHROMATABS._prefs.getCharPref("colorMode");
		CHROMATABS._hashFallback = CHROMATABS._prefs.getBoolPref("hashFallback");

		// 2.3.0: repaint all tabs and redraw close buttons
		CHROMATABS.log("Repainting all tabs...");
		CHROMATABS.colorizeAllTabs();

	}
    },

    /*
     * init
     *
     * Chromatabs initialization. Called when once, when a window opens.
     */
    init : function () {
	this._logService = Components.classes['@mozilla.org/consoleservice;1'].getService();
	this._logService.QueryInterface(Components.interfaces.nsIConsoleService);

        this._prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(
                                Components.interfaces.nsIPrefService).getBranch("extensions.chromatabs.");
	this._prefs.QueryInterface(Components.interfaces.nsIPrefBranch2);
	this._prefs.addObserver("", this._prefObserver, false);

	this._debug     = this._prefs.getBoolPref("debug");
    this._colorMode    = this._prefs.getCharPref("colorMode");
	this._hashFallback = this._prefs.getBoolPref("hashFallback");

    if (this._colorMode == "icon") {
		// use new colorMode
		this._colorMode == "icon-average"
		this._prefs.setCharPref("colorMode", "icon-average");
	}


	this.log("Chromatabs initializing...");

	// We'll be needing a <canvas> element to do the image processing... It requires a
	// docshell (?) to work, so we'll stash it inside a hidden <iframe>.

	// Create an iframe, make it hidden, and secure it against untrusted content.
	var iframe = document.createElement('iframe');
	iframe.setAttribute("type", "content");


	// Insert the iframe into the window, creating the doc shell.
	document.documentElement.appendChild(iframe);

	// When we insert the iframe into the window, it immediately starts loading
	// about:blank, which we don't need and could even hurt us (for example
	// by triggering bugs like bug 344305), so cancel that load.
	var webNav = iframe.docShell.QueryInterface(Components.interfaces.nsIWebNavigation);
	webNav.stop(Ci.nsIWebNavigation.STOP_NETWORK);

	// TODO: trunk hack to avoid flashing white in content bug?
	iframe.setAttribute("hidden", "true");
	//iframe.setAttribute("collapsed", true);

	this._canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
	iframe.appendChild(this._canvas);

	// 3.0.0: Need to determine what version to use...

	// assuming we're running under Firefox.  Thanks https://developer.mozilla.org/en/Using_nsIXULAppInfo
	var appInfo = Components.classes["@mozilla.org/xre/app-info;1"]
					.getService(Components.interfaces.nsIXULAppInfo);
	var versionChecker = Components.classes["@mozilla.org/xpcom/version-comparator;1"]
                    .getService(Components.interfaces.nsIVersionComparator);
    var FirefoxVersion = (versionChecker.compare(appInfo.version, "4.0b4") >= 0) ? 4 : 3;

	// Add listeners for the various tab events

	// 3.0.0:  Firefox 4 has tab listeners in gBrowser.tabContainer, but Firefox 3 uses gBrowser.
	var tabEventListenerSource;
	if (FirefoxVersion >= 4) {
		tabEventListenerSource = gBrowser.tabContainer;
	}
	else  {
		tabEventListenerSource = gBrowser;
	}

	tabEventListenerSource.addEventListener("TabOpen",   this.onTabOpen,   false);
	tabEventListenerSource.addEventListener("SSTabRestoring",this.onTabRestore, false);
	tabEventListenerSource.addEventListener("TabMove",   this.onTabMove,   false);
	tabEventListenerSource.addEventListener("TabSelect", this.onTabSelect, false);

	// Watch for mouse in/out so we can handle CSS :hover rules
	gBrowser.mStrip.addEventListener("mouseover", CHROMATABS.onMouseInEvent,  false);
	gBrowser.mStrip.addEventListener("mouseout",  CHROMATABS.onMouseOutEvent, false);

	// Listen for location changes and favicon loads.
	gBrowser.addProgressListener(CHROMATABS._locationListener);

	// The initial tab is selected.
	CHROMATABS.lastSelectedTab = gBrowser.mTabs[0];

    },


    onTabOpen: function (event) {
	// The location listener will take care of colorizing the tab.
	// When using "Open In New Tab", the location listener doesn't catch the new tab, so this is necessary.
	var tab = event.originalTarget;
	tab.setAttribute("onload","CHROMATABS.colorizeTab(this, false);")
	//tab.setAttribute("onerror","CHROMATABS.log('icon load failure');")


    },

    onTabRestore: function (event) {
	// Restoring a tab from a previous session...
	CHROMATABS.log("restored tab");

	var tab = event.originalTarget;
	var savedColor = CHROMATABS_SS.getTabValue(tab, "chromatabsColor");
	CHROMATABS.colorizeTab(tab, true);

    },


    onTabMove: function (event) {
	CHROMATABS.log("tab moved");

	var tab = event.originalTarget;
	//var browser = tab.linkedBrowser;

	// XXX - bug? the event listeners seem to disappear when the tab is moved!
	// ...fixed by moving listeners to tab strip. (re-adding them also worked)

	// You'd kinda think it would stay colored, but it doesn't.
	CHROMATABS.colorizeTab(tab, false);
    },


    onTabClose: function (event) {
	// (No tab to colorize, obviously.)
    },


    onTabSelect: function (event) {
	CHROMATABS.log("tab selected");

	// Recolor the tab that just got deselected
	var oldTab = CHROMATABS.lastSelectedTab;

	var tab = event.originalTarget;
	CHROMATABS.lastSelectedTab = tab;

	if (oldTab) {
		CHROMATABS.log("deselecting last tab");
		CHROMATABS.colorizeTab(oldTab, false);
	}

	CHROMATABS.colorizeTab(tab, false);
    },


    onMouseInEvent : function (event) {
	// Ignore events targeted at other bits of the tabstrip
	// XXX - Weird. The first tab's (from startup) event gives us "xul:tab", others seem to be just "tab".
	if (event.target.nodeName != "xul:tab" && event.target.nodeName != "tab") { return; }

	//CHROMATABS.log("mouse IN event to " + event.target.nodeName);

	var tab = event.target;

	// Make sure the UI stays in sync, by canceling any pending delayed-mouseout
	var delayID = tab.getAttribute("x-chromatabs-delayid");
	if (delayID) {
		CHROMATABS.log("clearing pending delayed-mouseout handler (delayID=" + delayID + ")");
		clearTimeout(delayID);
		tab.setAttribute("x-chromatabs-delayid", null);
	}
	tab.hovered = true; // 2.3.0: track hover state
	CHROMATABS.colorizeTab(tab, false);
    },


    /*
     * onMouseOutEvent
     *
     * Ideally, this should be a simple function like onMouseInEvent. Unfortunately,
     * when we call getComputedStyle() we still get the style for the hovered element.
     * In other words, CSS thinks the mouse is still over the tab and so we get the
     * wrong set of background images.
     *
     * As a workaround, triggered ourself as a callback, delayed by 1ms. That seems to
     * allow things to get back in sync.
     *
     * XXX - The delay also results in an undesirable flicker, probably between when CSS
     * sets the unhovered image and our delayed handler fires.
     */
    onMouseOutEvent : function (event, delayed, realtab) {

	// Ignore events targeted at other bits of the tabstrip
	if (!delayed && event.target.nodeName != "xul:tab" && event.target.nodeName != "tab") { return; }

	//CHROMATABS.log("mouse OUT event to " + event.target.nodeName + (delayed ? " (delayed event)" : ""));

	var tab = event.target;

	// XXX - Hmm, "event" is sometimes wrong when the delayed handler is invoked. (eg, it's an xul:label or xul:hbox)
	// Not sure I understand exactly why that is, but explicitly passing along the tab in "realtab" seems to work.
	// (Maybe the Event is being reused, and the target being changed as it captures/bubbles?)
	if (delayed) { tab = realtab; }

	var delayID = tab.getAttribute("x-chromatabs-delayid");

	// If we are a delayed event (see below), don't do anything if some other in/out event
	// has already executed and cleared the delayID.
	if (delayed) {
		if (!delayID) {
			CHROMATABS.log("delayed mouseout is unneeded.");
			return;
		}

		CHROMATABS.log("delayed mouseout executing. (delayID=" + delayID + ")");
		tab.hovered = false; // 2.3.0: track hover state
		CHROMATABS.colorizeTab(tab, false);

		tab.setAttribute("x-chromatabs-delayid", null);

		return;
	}

	// This shouldn't happen. If there's already a pending delated-mouseout, we shouldn't be getting
	// this mouseout event without an interveining mousein, which would have cleared the delayID.
	if (delayID) {
		CHROMATABS.log("Oops! Unexpected mouseout! (delayID=" + delayID + ")");
		return;
	}

	CHROMATABS.log("delaying mouseout handling.");
	delayID = setTimeout(CHROMATABS.onMouseOutEvent, 0, event, true, tab);
	tab.setAttribute("x-chromatabs-delayid", delayID);
    },


    /*
     * colorizeTab
     *
     * Given a <tab>, step into the it's implementation (anonymous nodes from XBL) and colorize each component.
     * This works for the default theme, but some other themes may change the layout and break us.
     */
    colorizeTab : function (tab, byEventHandler, NoCache) {

	var color, node;
	var doFallback = false;
	CHROMATABS.log("Colorizing tab[" +tab._tPos + "] " + (byEventHandler ? " (ASYNC) " : " ") + this._colorMode);

	var doc = tab.ownerDocument;

	if (this._colorMode == "icon" || this._colorMode == "icon-frequency" || this._colorMode == "icon-average") {
		color = CHROMATABS.getFaviconColor(tab, byEventHandler, NoCache);
		CHROMATABS.log("Got favicon color: " + color);

		// Ignore icons with no color.
		if (color == "rgba(0, 0, 0, 1)" || color == "rgba(255, 255, 255, 1)" || color == null) {
			if (!this._hashFallback) { CHROMATABS.log("Not falling back.  Exiting colorizeTab."); return; }
			doFallback = true;
		}
	}

	if (this._colorMode == "hash" || doFallback) {
		CHROMATABS.log("Doing fall back...");
		color = CHROMATABS.computeHostnameColor(tab);
	}

	var minSaturation, maxSaturation, minLuminance, maxLuminance, opacity;
	minSaturation = 0;
	CHROMATABS.log("Hover check: " + tab.hovered);
	if (tab.selected) {
			maxSaturation = CHROMATABS._prefs.getIntPref("focusedTab.maxSaturation");
			minLuminance = CHROMATABS._prefs.getIntPref("focusedTab.minLuminance");
			maxLuminance = CHROMATABS._prefs.getIntPref("focusedTab.maxLuminance");
        	opacity = CHROMATABS._prefs.getIntPref("focusedTab.opacity");
	} else if (tab.hovered)  {
			maxSaturation = CHROMATABS._prefs.getIntPref("hoverTab.maxSaturation");
			minLuminance = CHROMATABS._prefs.getIntPref("hoverTab.minLuminance");
			maxLuminance = CHROMATABS._prefs.getIntPref("hoverTab.maxLuminance");
        	opacity = CHROMATABS._prefs.getIntPref("hoverTab.opacity");
	} else {
			maxSaturation = CHROMATABS._prefs.getIntPref("backgroundTabs.maxSaturation");
			minLuminance = CHROMATABS._prefs.getIntPref("backgroundTabs.minLuminance");
			maxLuminance = CHROMATABS._prefs.getIntPref("backgroundTabs.maxLuminance");
        	opacity = CHROMATABS._prefs.getIntPref("backgroundTabs.opacity");
	}

	if (!color) return; // 2.3.0: prevent those pesky error messages about color being null

	// parse the "color" variable  which should be the form xxxx(R, G, B, 1);
	CHROMATABS.log("Parsing color: " + color);
	var temp = color.split(",");
	var temp2  = temp[0].split("(");
	var rgbRed = temp2[1] - 0, rgbGreen = temp[1] - 0, rgbBlue = temp[2] - 0;
	CHROMATABS.log("Converting: " + rgbRed + ", " + rgbGreen + ", " + rgbBlue);

	var hsl = CHROMATABS.rgbToHsl(rgbRed, rgbGreen, rgbBlue);
	var hue = hsl[0] * 360; // convert from [0,1] to [0, 360]
	saturation = hsl[1] * 100; // convert from [0,1] to [0, 100]
	luminance = hsl[2] * 100; // convert from [0,1] to [0, 100]

	// fit to tolerances
	if (saturation < minSaturation) saturation = minSaturation;
	if (saturation > maxSaturation) saturation = maxSaturation;
	if (luminance < minLuminance) luminance = minLuminance;
	if (luminance > maxLuminance) luminance = maxLuminance;

	CHROMATABS.log("Results of HSL: " + hsl[0] + ", " + hsl[1] + ", " + hsl[2]);

	color = "hsla(" + hue + ", " + saturation + "%, " + luminance + "%, " + (opacity / 100) + ")";
	
	// build baseColor from settings
	var baseColor = "rgba(%R,%G,%B,%A)";
	baseColor = baseColor.replace("%R", CHROMATABS._prefs.getIntPref("base.red"));
	baseColor = baseColor.replace("%G", CHROMATABS._prefs.getIntPref("base.green"));
	baseColor = baseColor.replace("%B", CHROMATABS._prefs.getIntPref("base.blue"));
	baseColor = baseColor.replace("%A", CHROMATABS._prefs.getIntPref("base.opacity") / 100.0);
	CHROMATABS.log("Using baseColor of " + baseColor);

	try {
		CHROMATABS.setTabColor(tab, color, baseColor);
	} catch (e) { }

    },

	setTabColor : function (tab, tabColor, baseColor) {
		CHROMATABS.log("Setting tab color to: " + tabColor);
		CHROMATABS_SS.setTabValue(tab, "chromatabsColor", tabColor);
		tab.setAttribute('bkgdColor', tabColor);

		var newImage;
		newImage  = "-moz-linear-gradient(rgba(255,255,255,.5), rgba(255,255,255,.0) 10%), ";
		newImage += "-moz-linear-gradient(%TAB_COLOR%, %BASE_COLOR% 75%)";
		
		newImage = newImage.replace(/%TAB_COLOR%/g, tabColor);
		newImage = newImage.replace(/%BASE_COLOR%/g, baseColor);

		CHROMATABS.log("Setting tab background-image to: " + newImage);
		tab.style.setProperty('background-image', newImage,'important');

//		CHROMATABS.colorPseudoBottomBar(); // Fake the tabstrip border from Firefox 3 inside Firefox 4.
	},


    getFaviconURL : function (tab) {
	var imgsrc1 = tab.getAttribute("image");
	// When we get an onLinkIconAvailable event, the image attribute doesn't seem to be set yet.
	var imgsrc2 = (tab.linkedBrowser ? tab.linkedBrowser.mIconURL : null);

	this.log("tab.image = " + imgsrc1 + ", tab.mIconURL = " + imgsrc2);

	return (imgsrc1 ? imgsrc1 : imgsrc2);
    },

    _iconColorCache : {},

    getFaviconColor : function (tab, byEvent, NoCache) {

	var imgsrc = this.getFaviconURL(tab);
	if (!imgsrc) { return null; }

	// Check for a cached value
	if (imgsrc in CHROMATABS._iconColorCache && !NoCache) {
		var color = CHROMATABS._iconColorCache[imgsrc];
		CHROMATABS.log("Using cached color for " + imgsrc);
		return color;
	}

	// No cached value, so we'll have to do things the slow way....
	// Render the image in a <canvas>, and wade through the pixel data.
	var canvas = CHROMATABS._canvas;
	var ctx = canvas.getContext("2d");

	// Get the original image being used
	var img = new Image();
	img.src = imgsrc;
	if (!img.complete) {
		// The onload listener should always have the data, but if it somehow doesn't we'll just give up.
		if (!byEvent) {
			CHROMATABS.log("...favicon not yet loaded, deferring processing to onload handler.");
			img.addEventListener("load", function() { CHROMATABS.colorizeTab(tab, true); }, false);
		} else {
			CHROMATABS.log("...favicon not yet loaded, but we're the onload handler! WTF!!!.");
		}
		return null;
	}

	if (img.height == 0) {
		// no image is loaded
		CHROMATABS.log("No favicon at all!");
		return null;
	}

	// Set canvas size to favicon size (source image could be bigger, but we don't really need all of it.)
	canvas.setAttribute("width", 16);
	canvas.setAttribute("height", 16);

	// Draw original image to the canvas.
	ctx.drawImage(img, 0, 0, 16, 16);

	// Get the raw pixels. This returns an array of integers, 4 per pixel.
	// R, G, B, A,  R, G, B, A,  ...
	var pixels = ctx.getImageData(0,0,16,16).data;

	// No need to look at every pixel
	var stride = 3;

	// We'll use pixel (0,0) as a workpixel for compositing.
	ctx.clearRect(0, 0, 1, 1);

	var pixelCount = 0;

	var arrColor = new Array();
	var arrColorFreq = new Array();
	var nrColors = 0;

	for (var i = 0; i < 16*16; i += stride) {
		var p = 4*i;

		// Ignore pixels which are:
		// - mostly transparent
		// - almost white (many icons use a white background instead of being transparent)
		// - almost black (probably background color, shadow, or other non-interesting part of image)
		if (pixels[p+3] < 192) { continue; } // ignore pixels mostly transparent
		if (pixels[p] < 30   && pixels[p+1] < 30   && pixels[p+2] < 30  ) { continue; } // ignore black pixels
		if (pixels[p] > 230 && pixels[p+1] > 230 && pixels[p+2] > 230) { continue; } // ignore white pixels

		pixelCount++;

		// The logic here is sort of recursive... The Nth pixel should contribute (100/N)% of the
		// color for an N-pixel image, when drawn on top of the average of the previous N-1 pixels.
		//
		// 1st pixel drawn has 100% opacity.
		// 2nd pixel has 50% opacity,
		// 3rd pixel has 33% opacity
		// 4th pixel has 25% opacity, etc
		ctx.globalAlpha = 1.0 / (pixelCount);

		// Ignore alpha of source pixel.
		ctx.fillStyle = "rgba(" + pixels[p] + ", " + pixels[p+1] + ", "+ pixels[p+2] + ", 1)";

		// Draw the pixel onto workpixel, letting canvas handle the compositing math.
		ctx.fillRect(0, 0, 1, 1);

		// track the frequency of each color...
		var rgbColor = "" + pixels[p] + ", " + pixels[p+1] + ", "+ pixels[p+2] + "";

		var hsl = CHROMATABS.rgbToHsl(pixels[p], pixels[p+1], pixels[p+2]);
		var hueOnly = hsl[0];
		CHROMATABS.log("Hue is " + hueOnly);

		// see if it's in the list
		var bFound = false
		for (var j = 0; j < nrColors; j++) {
			var targetRGB = arrColor[j].split(',');
			var targetHSL = CHROMATABS.rgbToHsl(targetRGB[0], targetRGB[1], targetRGB[2] )
			var targetHue = targetHSL[0];

			// new 2.3 code: add some tolerance when matching
			if (Math.abs((hueOnly - targetHue)/targetHue) <= (CHROMATABS._hueTolerance / 100)) {

				// in the list, so increment tally
				arrColorFreq[j] += 1;
				bFound = true;
				break; // don't need to keep looking
			}
		}
		// not in the list, so add it
		if (!bFound) {
			arrColor[nrColors] = rgbColor
			arrColorFreq[nrColors] = 1;
			nrColors += 1;
		}

	}


	// find the most frequent color
	var maxFreq = 2, mostPopularColor = '';
	for (var j = 0; j < nrColors; j++) {
		if (arrColorFreq[j] >= maxFreq) {
			maxFreq = arrColorFreq[j];
			mostPopularColor = arrColor[j];
		}
	}
	CHROMATABS.log("Most popular color is " + mostPopularColor + " w/ a freq of " + maxFreq + " out of " + nrColors);

	// Get the pixels again, since we were not accessing a live version.
	pixels = ctx.getImageData(0,0,1,1).data;

	var color;
	if (CHROMATABS._colorMode == 'icon-frequency' && mostPopularColor != '') {
		color = "rgba(" + mostPopularColor + ", 1)";
	}
	else { // icon-average
		color = "rgba(" + pixels[0] + ", " + pixels[1] + ", "+ pixels[2] + ", 1)";
	}

	// Cache the value for speed.
	CHROMATABS._iconColorCache[imgsrc] = color;

	CHROMATABS.log("Computed color for " + imgsrc + ": " + color);

	return color;
    },


    //
    // computeHostnameColor
    //
    // Given a <tab>, compute what color it should be.
    //
    computeHostnameColor : function (tab) {
	var doc, host;

	function djb2hash(hashstring) {
		var i, hashvalue = 5381;
		for (i = 0; i < hashstring.length; i++) {
			var ascii_code = hashstring.charCodeAt(i);
			hashvalue = ((hashvalue << 5) + hashvalue) + ascii_code;
		}
		return hashvalue;
	};


	host = CHROMATABS.getHostnameForTab(tab);
	if (!host) { return null; }

	// Compute a hash of the hostname, and clamp it to the 0-360 range allowed for the hue.
	var hue = Math.abs(djb2hash(host)) % 360;
	var sat = Math.abs(djb2hash(host + host)) % 90 + 10 ;
	var lum = Math.abs(djb2hash(host + host + host)) % 75 + 25;

	CHROMATABS.log("Computed HSL as : " + hue + ", " + sat + ", " + lum);
	// Make the color string. eg: rgba(180, 200, 300, 1)
	var newRGB = CHROMATABS.hslToRgb(hue/360, sat/100, lum/100);
	var color = "rgba(" + newRGB[0] + ", " + newRGB[1] + ", " + newRGB[2] + ", 1) "
	CHROMATABS.log("... which converted into: " + color);
	return color;
    },


    getHostnameForTab : function (tab) {
	try {
		// stupid about:blank
		var host = tab.linkedBrowser.contentDocument.location.host;
	} catch (e) {
		return null;
	}

	// Strip off any leading "www" so that "www.site.com" and "site.com" hash to the same color.
	// (the 2 sites can be different, but this doesn't seem common)
	var matches = /^www\.(.+\..+)$/.exec(host);
	if (matches) { host = matches[1]; }

	// 2.3.0: If desired, treat all subdomains alike
	CHROMATABS.log("Original host is: " + host);

	subdomainsTreatedEqually = CHROMATABS._prefs.getBoolPref("hashFallback.subdomainsTreatedEqually");
	if (subdomainsTreatedEqually) {
		// reduce subdomain.domain.tld  to just subdomain.domain.tld
		var eTLDService = Components.classes["@mozilla.org/network/effective-tld-service;1"]
							.getService(Components.interfaces.nsIEffectiveTLDService);
		var ioService = Components.classes["@mozilla.org/network/io-service;1"].getService();
		var baseURI = ioService.newURI(tab.linkedBrowser.contentDocument.location.href, "UTF-8", null);

		host = eTLDService.getBaseDomain(baseURI)
		CHROMATABS.log("Reduced host is: " + host);
	}


	return host;
    },

	colorPseudoBottomBar :  function ()
	{
	var ss = new Array();
	var ss = document.styleSheets;
	for (var i=0; i < ss.length; i++)
		{
		switch (ss[i].href)
			{
			case 'chrome://chromatabs/skin/chromatabs.css':
				var clrSS = ss[i];
				break;
			}
		}
	try
		{
		CHROMATABS.log("Creating bottom bar...");

		var borderColor = gBrowser.selectedTab.getAttribute("bkgdColor");
		if (borderColor) {
			var newStyle = "3px solid " + borderColor;
			CHROMATABS.log("Creating bottom bar w/ style:  " + newStyle);
			clrSS.cssRules[11].style.setProperty ('border-bottom', newStyle,'important' );
		}
		else {
			clrSS.cssRules[11].style.setProperty ('margin-top', "3px",'important' );
		}
	}
	catch(e)
		{
		dump("\nctlog:\terror in function colorPseudoBottomBar "+e);
		}
	},

	colorizeAllTabs :  function ()
	{
		var nrTabs = gBrowser.mTabs.length;
		CHROMATABS.log("Found " + nrTabs + " tabs.");

		for (var i = 0; i < nrTabs; i++) {
			var currTab = gBrowser.mTabs[i];
			CHROMATABS.colorizeTab(currTab, false, true); // the last parameter says to not get the color from the cache
		}
	},

	// CREDIT FOR RGB <--> HSL CONVERSION CODE:
	// Michael Jackson (no, a different one)
	// http://mjijackson.com/2008/02/rgb-to-hsl-and-rgb-to-hsv-color-model-conversion-algorithms-in-javascript

	/**
	 * Converts an RGB color value to HSL. Conversion formula
	 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
	 * Assumes r, g, and b are contained in the set [0, 255] and
	 * returns h, s, and l in the set [0, 1].
	 *
	 * @param   Number  r       The red color value
	 * @param   Number  g       The green color value
	 * @param   Number  b       The blue color value
	 * @return  Array           The HSL representation
	 */
	rgbToHsl : function (r, g, b){
		r /= 255, g /= 255, b /= 255;
		var max = Math.max(r, g, b), min = Math.min(r, g, b);
		var h, s, l = (max + min) / 2;

		if(max == min){
			h = s = 0; // achromatic
		}else{
			var d = max - min;
			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
			switch(max){
				case r: h = (g - b) / d + (g < b ? 6 : 0); break;
				case g: h = (b - r) / d + 2; break;
				case b: h = (r - g) / d + 4; break;
			}
			h /= 6;
		}

		return [h, s, l];
	},

	/**
	 * Converts an HSL color value to RGB. Conversion formula
	 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
	 * Assumes h, s, and l are contained in the set [0, 1] and
	 * returns r, g, and b in the set [0, 255].
	 *
	 * @param   Number  h       The hue
	 * @param   Number  s       The saturation
	 * @param   Number  l       The lightness
	 * @return  Array           The RGB representation
	 */

	hslToRgb: function (h, s, l){
		var r, g, b;

		if(s == 0){
			r = g = b = l; // achromatic
		}else{
			function hue2rgb(p, q, t){
				if(t < 0) t += 1;
				if(t > 1) t -= 1;
				if(t < 1/6) return p + (q - p) * 6 * t;
				if(t < 1/2) return q;
				if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
				return p;
			}

			var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
			var p = 2 * l - q;
			r = hue2rgb(p, q, h + 1/3);
			g = hue2rgb(p, q, h);
			b = hue2rgb(p, q, h - 1/3);
		}

		return [r * 255, g * 255, b * 255];
	}

};

window.addEventListener("load", function () { CHROMATABS.init(); }, false);
