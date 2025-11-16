FROM node:20

# تثبيت Python
RUN apt-get update && apt-get install -y python3 python3-pip

# نسخ المشروع
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# تثبيت مكتبات بايثون
RUN pip3 install requests beautifulsoup4 lxml deep-translator

# تشغيل البوت
CMD ["node", "bot.js"]
