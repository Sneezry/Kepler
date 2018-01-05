"use strict";

let busy = false;

function httpRequest(url, isBlob){
    console.log(`Getting ${url}...`);
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.onreadystatechange = () => {
            if (xhr.readyState == 4) {
                if (xhr.status == 200) {
                    resolve(isBlob ? xhr.response : xhr.responseText);
                } else {
                    reject(new Error(`Error code: ${xhr.status}`));
                }
                return;
            }
        }
        xhr.onerror = error => {
            reject(error);
            return;
        }
        if (isBlob) {
            xhr.responseType = 'blob';
        }
        xhr.send();
    });
}

function getBookInfo(url) {
    const matches = url.match(/www\.safaribooksonline\.com\/library\/view\/(.*?)\/(\d+)[\/$]/);
    if (matches && matches.length > 2) {
        return {
            title: matches[1],
            id: matches[2]
        };
    }
    return null;
}

function generateTOC(toc) {
    let depth = 0;
    let root = {
        children: []
    };
    let indexes = [];
    let lastDepth = null;

    toc.items.forEach(item => {
        depth = Math.max(depth, item.depth);
        let _depth = item.depth - 1;
        indexes[_depth] = indexes[_depth] || 0;

        if (lastDepth === null || lastDepth < item.depth) {
            indexes[_depth] = 0;
        } else {
            indexes[_depth]++;
        }

        let _point = root;
        for (let i = 0; i <= _depth; i++) {
            _point.children[indexes[i]] = _point.children[indexes[i]] || {
                label: null,
                order: null,
                id: null,
                href: null,
                children: []
            };
            _point = _point.children[indexes[i]];
        }

        _point.label = item.label;
        _point.order = item.order;
        _point.id = item.id;
        _point.src = item.href;

        lastDepth = item.depth;
    });

    let navMap = getMap(root.children);

    let ncx = `<?xml version="1.0" encoding="utf-8" standalone="no"?>
<ncx xmlns:ncx="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <head>
    <meta name="cover" content="cover"/>
    <meta name="dtb:uid" content="isbn:${toc.book_id}"/>
    <meta name="dtb:depth" content="${depth}"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
    </head>
    <docTitle>
        <text>${toc.title}</text>
    </docTitle>
    <docAuthor>
        <text>${toc.authors}</text>
    </docAuthor>
    <navMap>
${navMap}
    </navMap>
</ncx>`;

    let opfItems = '';
    let xmlItems = '';
    toc.items.forEach(item => {
        opfItems = `${opfItems}
<item id="${item.id}" href="${item.href.split('#')[0]}" media-type="${item.media_type}"/>
        `;
        if (item.media_type === 'application/xhtml+xml') {
            xmlItems = `${xmlItems}
<itemref idref="${item.id}"/>
            `;
        }
    });

    let opf = `<?xml version="1.0" encoding="utf-8" standalone="no"?>
<package xmlns:epub="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
    <metadata>
    <dc:identifier xmlns:dc="http://purl.org/dc/elements/1.1/" id="bookid">urn:isbn:${toc.book_id}</dc:identifier>
    <dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">${toc.title}</dc:title>
    <!-- <dc:rights xmlns:dc="http://purl.org/dc/elements/1.1/"></dc:rights> -->
    <dc:publisher xmlns:dc="http://purl.org/dc/elements/1.1/">${toc.publisher.name}</dc:publisher>
    <!-- <dc:subject xmlns:dc="http://purl.org/dc/elements/1.1/"></dc:subject> -->
    <dc:date xmlns:dc="http://purl.org/dc/elements/1.1/">${toc.pub_date}</dc:date>
    <!-- <dc:description xmlns:dc="http://purl.org/dc/elements/1.1/"></dc:description> -->
    <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf" opf:file-as="Douglas Crockford">${toc.authors}</dc:creator>
    <dc:language xmlns:dc="http://purl.org/dc/elements/1.1/">en</dc:language>
    <meta name="cover" content="cover-image"/>
    </metadata>
    <manifest>
    <item id="ncxtoc" media-type="application/x-dtbncx+xml" href="toc.ncx"/>
    <item id="cover-image" href="cover-image.jpg" media-type="image/jpeg"/>
${opfItems}
    </manifest>
    <spine toc="ncxtoc">
    <itemref idref="cover-image" linear="no"/>
${xmlItems}
    </spine>
</package>`;

    return {ncx, opf};
}

function getMap(points) {
    let map = '';
    points.forEach(point => {
        map = `${map}
<navPoint id="${point.id}" playOrder="${point.order}">
    <navLabel>
        <text>${point.label}</text>
    </navLabel>
    <content src="${point.src.split('#')[0]}"/>
    ${point.children ? getMap(point.children) : ''}
</navPoint>`;
    });
    return map;
}

function Kepler(info) {
    this.id = info.id;
    this.title = info.title;
    this.pages = [];
    this.gotItem = 0;
}

Kepler.prototype.INTERVAL = 1000;

Kepler.prototype.getBook = function() {
    chrome.browserAction.setBadgeText({text: '0'});
    return new Promise((resolve, reject) => {
        const url = `https://www.safaribooksonline.com/nest/epub/toc/?book_id=${this.id}`;
        httpRequest(url).then(res => {
            try {
                const toc = JSON.parse(res);
                this.totalItem = toc.items.length;
                this.toc = generateTOC(toc);
                this.parseTOC(toc).then(() => {
                    this.getSingleImageData(`https://www.safaribooksonline.com/library/cover/${this.id}/720h/`, 'cover-image.jpg')
                    .then(() => {
                        this.save().then(resolve, reject);
                    }, reject);
                }, reject);
            } catch(error) {
                reject(error);
            }
        }, reject);
    });
}

Kepler.prototype.parseTOC = function(toc) {
    return new Promise((resolve, reject) => {
        const items = toc.items;
        const itemPromises = [];
        let currentIndex = 0;
        const queue = setInterval(() => {
            if (currentIndex < items.length) {
                itemPromises.push(this.getSingleItem(items[currentIndex++]));
            } else {
                clearInterval(queue);
                Promise.all(itemPromises).then(resolve, reject);
            }
        }, this.INTERVAL);
    });
}

Kepler.prototype.getSingleItem = function(item) {
    return new Promise((resolve, reject) => {
        const url = `https://www.safaribooksonline.com${item.url}`;
        httpRequest(url).then(res => {
            try {
                const page = JSON.parse(res);
                this.getSinglePage(item, page).then(() => {
                    this.gotItem++;
                    const process = Math.floor(this.gotItem / this.totalItem * 100);
                    chrome.browserAction.setBadgeText({text: process.toString()});
                    resolve();
                }, reject);
                return;
            } catch(error) {
                reject(error);
                return;
            }
        }, reject);
    });
}

Kepler.prototype.getSinglePage = function(item, page) {
    return new Promise((resolve, reject) => {
        const url = page.content;
        const name = page.full_path;
        httpRequest(url).then(res => {
            const content = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"
            xmlns:epub="http://www.idpf.org/2007/ops">
    <head>
        <title>${page.title}</title>
    </head>
    <body>
        ${res}
    </body>
</html>`;
            const _page = {
                name: name,
                label: item.label,
                order: item.order,
                depth: item.depth,
                base64: false,
                content: content.replace(/&nbsp;/g, ' ')
                                .replace(/<hr>/g, '<hr/>')
                                .replace(/<br>/g, '<br/>')
                                .replace(/(<img[^>]*[^\/>])>/, '$1/>')
            };
            this.pages.push(_page);
            this.getImages(page.images).then(resolve, reject);
        }, reject);
    });
}

Kepler.prototype.getImages = function(urls) {
    return new Promise((resolve, reject) => {
        const imagePromises = [];
        let currentIndex = 0;
        const queue = setInterval(() => {
            if (currentIndex < urls.length) {
                let url = urls[currentIndex++].replace(/\.\.\\/g, '');
                url = `https://www.safaribooksonline.com/library/view/${this.title}/${this.id}/${url}`;
                imagePromises.push(this.getSingleImageData(url));
            } else {
                clearInterval(queue);
                Promise.all(imagePromises).then(resolve, reject);
            }
        }, this.INTERVAL);
    });
}

Kepler.prototype.getSingleImageData = function(url, name) {
    return new Promise((resolve, reject) => {
        httpRequest(url, true).then(res => {
            name = name || url.match(/([^\/]+)$/)[1];
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const content = reader.result;
                    const image = {
                        name: name,
                        base64: true,
                        content: content.split(',')[1]
                    };
                    this.pages.push(image);
                    resolve();
                    return;
                } catch(error) {
                    reject(error);
                    return;
                }
            };
            reader.readAsDataURL(res);
        }, reject);
    });
}

Kepler.prototype.save = function() {
    return new Promise((resolve, reject) => {
        try {
            chrome.browserAction.setBadgeText({text: '...'});
            const title = this.title;
            const toc = this.toc;
            const zip = new JSZip();
            zip.file('mimetype', 'application/epub+zip');
            const meta = zip.folder('META-INF');
            meta.file('container.xml', `<?xml version="1.0" encoding="utf-8" standalone="no"?>
        <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
            <rootfiles>
                <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
            </rootfiles>
        </container>`);
            const OEBPS = zip.folder('OEBPS');
            const assets = OEBPS.folder('assets');
            OEBPS.file('toc.ncx', toc.ncx);
            OEBPS.file('content.opf', toc.opf);
            this.pages.forEach(page => {
                if (page.base64 && page.name !== 'cover-image.jpg') {
                    assets.file(page.name, page.content, {base64: page.base64});
                } else {
                    OEBPS.file(page.name, page.content, {base64: page.base64});
                }
            });
            zip.generateAsync({type:'blob'})
            .then(function(content) {
                saveAs(content, `${title}.epub`);
                resolve();
            }, reject);
        } catch(error) {
            reject(error);
        }
    });
}

function setBusy(_busy) {
    busy = _busy;
    const icon = _busy ? 'kepler-busy.png' : 'kepler.png';
    chrome.browserAction.setIcon({
        path: {
            '19': icon,
            '38': icon
        }
    });

    if (!_busy) {
        chrome.browserAction.setBadgeText({text: ''});
    }
}

chrome.browserAction.setBadgeBackgroundColor({color: '#000'});

chrome.browserAction.onClicked.addListener((tab) => {
    if (busy) {
        return;
    }

    setBusy(true);

    const url = tab.url;
    if (!/:\/\/www\.safaribooksonline\.com/.test(url)) {
        setBusy(false);
        return;
    }

    const info = getBookInfo(url);

    if (!info) {
        setBusy(false);
        return;
    }

    const kepler = new Kepler(info);
    kepler.getBook().then(() => {
        setBusy(false);
    }, error => {
        setBusy(false);
        throw error;
    });
});