# Use Node 20
FROM node:20

# تثبيت Python
RUN apt-get update && apt-get install -y python3 python3-pip

# إعداد مجلد العمل
WORKDIR /app

# نسخ ملفات Nodejs
COPY package*.json ./
RUN npm install

# نسخ باقي المشروع
COPY . .

# تثبيت مكتبات Python
RUN pip3 install --no-cache-dir -r requirements.txt

# تشغيل البوت
CMD ["node", "bot.js"]
