#!/usr/bin/env python3
import sys
import requests
import json
import os
import re
from bs4 import BeautifulSoup
from urllib.parse import quote, urljoin
import time
from deep_translator import GoogleTranslator

def log(message):
    print(f"[SCRAPER] {message}", file=sys.stderr)

def translate_to_english(text):
    try:
        if re.search(r'[\u0600-\u06FF]', text):
            translator = GoogleTranslator(source='ar', target='en')
            translated = translator.translate(text)
            log(f"Translated '{text}' to '{translated}'")
            return translated
        return text
    except Exception as e:
        log(f"Translation failed: {str(e)}, using original text")
        return text

def search_apkpure(app_name):
    english_name = translate_to_english(app_name)
    search_url = f"https://apkpure.com/search?q={quote(english_name)}"
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ar,en-US,en;q=0.5',
        'Referer': 'https://apkpure.com/',
    }
    
    try:
        log(f"البحث في APKPure عن: {app_name}")
        response = requests.get(search_url, headers=headers, timeout=30)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        results = []
        
        search_results = soup.find_all('div', class_='first')
        if not search_results:
            search_results = soup.find_all('a', class_='first-info')
        if not search_results:
            search_results = soup.find_all('dl', class_='search-dl')
        if not search_results:
            search_container = soup.find('div', id='search-res') or soup.find('div', class_='search-result')
            if search_container:
                search_results = search_container.find_all('a', href=re.compile(r'/.*/.*/download'))
        
        if not search_results:
            log("No search results found")
            return []
        
        for item in search_results[:5]:
            link = item if item.name == 'a' else item.find('a', href=True)
            if not link:
                continue
            
            app_url = urljoin('https://apkpure.com', link.get('href', ''))
            if not app_url or 'apkpure.com' not in app_url:
                continue
            
            app_title = link.get('title', '')
            if not app_title:
                title_elem = item.find('p', class_='p1') or item.find('div', class_='title')
                if title_elem:
                    app_title = title_elem.get_text(strip=True)
            if not app_title:
                app_title = link.get_text(strip=True)
            
            if app_title and app_url:
                results.append((app_url, app_title))
                log(f"Found: {app_title} - {app_url}")
        
        return results
        
    except Exception as e:
        log(f"Search error: {str(e)}")
        return []

def get_app_info_and_download(app_url, app_title):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://apkpure.com/',
    }
    
    try:
        log(f"Getting app details from: {app_url}")
        response = requests.get(app_url, headers=headers, timeout=20)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        icon_url = None
        
        og_image = soup.find('meta', property='og:image')
        if og_image and og_image.get('content'):
            icon_url = og_image['content']
        
        if not icon_url:
            icon_elem = soup.find('img', itemprop='image')
            if icon_elem and icon_elem.get('src'):
                icon_url = icon_elem['src']
        
        if not icon_url:
            icon_container = soup.find('div', class_='icon') or soup.find('div', class_='app-icon')
            if icon_container:
                icon_elem = icon_container.find('img')
                if icon_elem and icon_elem.get('src'):
                    icon_url = icon_elem['src']
        
        if not icon_url:
            icon_elem = soup.find('img', class_='icon')
            if icon_elem and icon_elem.get('src'):
                icon_url = icon_elem['src']
        
        if icon_url:
            icon_url = re.sub(r'/w/\d+', '', icon_url)
            icon_url = re.sub(r'=w\d+', '', icon_url)
            if not icon_url.startswith('http'):
                icon_url = urljoin('https://apkpure.com', icon_url)
        
        version = "Latest"
        version_elem = soup.find('span', class_='version') or soup.find('div', class_='ver')
        if version_elem:
            version_text = version_elem.get_text(strip=True)
            version = version_text.replace('Version:', '').strip()
        
        developer = "Unknown"
        dev_elem = soup.find('a', itemprop='author') or soup.find('p', class_='author')
        if dev_elem:
            developer = dev_elem.get_text(strip=True)
        
        download_link = None
        download_selectors = [
            {'class_': 'download-btn'},
            {'class_': 'da'},
            {'id': 'download_button'},
            {'text': re.compile(r'Download.*APK', re.I)},
        ]
        
        for selector in download_selectors:
            download_link = soup.find('a', **selector)
            if download_link and download_link.get('href'):
                break
        
        if not download_link or not download_link.get('href'):
            log("Could not find download link")
            return None
        
        download_page_url = urljoin('https://apkpure.com', download_link['href'])
        
        log(f"Getting download link from: {download_page_url}")
        download_page = requests.get(download_page_url, headers=headers, timeout=20)
        download_page.raise_for_status()
        
        download_soup = BeautifulSoup(download_page.text, 'html.parser')
        
        direct_download = None
        download_link_selectors = [
            {'id': 'download_link'},
            {'class_': 'download-click'},
            {'class_': 'downloadButton'},
            {'href': re.compile(r'.*\.apk$|.*\.xapk$|.*\.apks$', re.I)},
        ]
        
        for selector in download_link_selectors:
            direct_download = download_soup.find('a', **selector)
            if direct_download and direct_download.get('href'):
                break
        
        if not direct_download or not direct_download.get('href'):
            log("Could not find direct download link")
            return None
        
        final_download_url = direct_download['href']
        if not final_download_url.startswith('http'):
            final_download_url = urljoin('https://apkpure.com', final_download_url)
        
        log(f"Download URL: {final_download_url}")
        
        log("Downloading file...")
        response = requests.get(final_download_url, headers=headers, stream=True, timeout=300)
        response.raise_for_status()
        
        file_ext = '.apk'
        has_obb = False
        content_disp = response.headers.get('content-disposition', '')
        if '.xapk' in content_disp.lower() or '.xapk' in final_download_url.lower():
            file_ext = '.xapk'
            has_obb = True
        elif '.apks' in content_disp.lower() or '.apks' in final_download_url.lower():
            file_ext = '.apks'
        
        total_size = int(response.headers.get('content-length', 0))
        size_mb = total_size / (1024 * 1024) if total_size > 0 else 0
        
        safe_filename = re.sub(r'[^a-zA-Z0-9_-]', '_', app_title)
        filename = f"{safe_filename}{file_ext}"
        
        downloads_dir = "downloads"
        if not os.path.exists(downloads_dir):
            os.makedirs(downloads_dir)
        
        file_path = os.path.join(downloads_dir, filename)
        with open(file_path, 'wb') as f:
            downloaded = 0
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total_size > 0:
                        percent = (downloaded / total_size) * 100
                        log(f"Progress: {percent:.1f}%")
        
        log(f"✅ File downloaded: {size_mb:.2f} MB")
        
        return {
            "name": app_title,
            "version": version,
            "size": f"{size_mb:.2f} MB" if size_mb > 0 else "Unknown",
            "sizeMB": size_mb,
            "developer": developer,
            "filename": filename,
            "fileType": file_ext.upper().replace('.', ''),
            "iconUrl": icon_url,
            "hasOBB": has_obb
        }
        
    except Exception as e:
        log(f"Error downloading app: {str(e)}")
        return None

def download_app(app_name):
    search_results = search_apkpure(app_name)
    
    if not search_results:
        return {"error": f"لم يتم العثور على '{app_name}' في APKPure.\n\nجرب:\n• استخدام الاسم الكامل للتطبيق\n• التحقق من الإملاء\n• كن أكثر تحديداً"}
    
    for app_url, app_title in search_results:
        log(f"محاولة التحميل: {app_title}")
        result = get_app_info_and_download(app_url, app_title)
        
        if result:
            return result
        else:
            log(f"فشل تحميل {app_title}, جاري المحاولة التالية...")
    
    return {"error": f"تم العثور على تطبيقات تطابق '{app_name}' لكن فشل تحميلها.\n\nالتطبيقات قد لا تكون متاحة أو حدث خطأ في التحميل."}

def main():
    if len(sys.argv) < 2:
        result = {"error": "No app name provided"}
        print(json.dumps(result))
        sys.exit(0)
    
    try:
        app_name = ' '.join(sys.argv[1:])
        log(f"Starting search for: {app_name}")
        result = download_app(app_name)
        
        if result is None:
            result = {"error": "Download failed - no result returned"}
        
        log(f"Returning result: {json.dumps(result)}")
        print(json.dumps(result))
        sys.exit(0)
    except Exception as e:
        log(f"Fatal error in main: {str(e)}")
        result = {"error": f"Script error: {str(e)}"}
        print(json.dumps(result))
        sys.exit(1)

if __name__ == "__main__":
    main()
