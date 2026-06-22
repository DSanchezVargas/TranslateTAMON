FROM node:20-bullseye

# Instalar Python, pip y dependencias del sistema requeridas para OCR / PDF
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    tesseract-ocr \
    tesseract-ocr-spa \
    tesseract-ocr-eng \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

# Configurar directorio de trabajo
WORKDIR /app
# Copiar archivos de empaquetado de dependencias
COPY package*.json ./
COPY Back/package*.json ./Back/

# Instalar dependencias de Node
RUN npm install
RUN npm install --prefix Back

# Copiar dependencias de Python y ejecutarlas
COPY Back/python_services/requirements.txt ./requirements.txt
RUN pip3 install --no-cache-dir -r requirements.txt

# Copiar todo el código del proyecto al contenedor
COPY . .

# Exponer el puerto principal de la aplicación (Express)
EXPOSE 3000

# Arrancar concurrentemente el servidor Node y los procesadores Python
CMD ["npm", "start"]
