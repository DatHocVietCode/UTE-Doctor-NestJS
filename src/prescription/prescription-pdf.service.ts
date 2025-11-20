
import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import { CreatePrescriptionPdfDto } from 'src/prescription/dto/create.pdf';

@Injectable()
export class PrescriptionPdfService {
  private readonly logger = new Logger(PrescriptionPdfService.name);

  async generatePrescriptionPdf(
    id: string,
    data: CreatePrescriptionPdfDto,
  ): Promise<string> {
    // Save PDFs under a public folder so they can be served via HTTP
    const outputDir = path.join(process.cwd(), 'public', 'prescription', id);
    const outputPath = path.join(outputDir, 'prescription.pdf');

    try {
      // Tạo thư mục nếu chưa tồn tại
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Khởi tạo Puppeteer
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();

      // Generate HTML content
      const htmlContent = this.generateHtmlTemplate(data);

      // Set content và tạo PDF
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

      await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm',
        },
      });

      await browser.close();

      this.logger.log(`PDF created successfully at: ${outputPath}`);

      // Return the public URL path (controller will build full URL)
      const urlPath = `/prescription/${id}/prescription.pdf`;
      return urlPath;
    } catch (error) {
      this.logger.error(`Error generating PDF: ${error.message}`);
      throw error;
    }
  }

  private generateHtmlTemplate(data: CreatePrescriptionPdfDto): string {
    const formattedDate = new Date(data.dateRecord).toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    return `
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Đơn Thuốc</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Arial', sans-serif;
            line-height: 1.6;
            color: #333;
            padding: 20px;
          }
          
          .header {
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 3px solid #2c5aa0;
            padding-bottom: 20px;
          }
          
          .header h1 {
            color: #2c5aa0;
            font-size: 28px;
            margin-bottom: 10px;
          }
          
          .header p {
            color: #666;
            font-size: 14px;
          }
          
          .info-section {
            margin-bottom: 25px;
          }
          
          .info-row {
            display: flex;
            margin-bottom: 10px;
          }
          
          .info-label {
            font-weight: bold;
            min-width: 150px;
            color: #2c5aa0;
          }
          
          .info-value {
            flex: 1;
          }
          
          .diagnosis-section {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 25px;
            border-left: 4px solid #2c5aa0;
          }
          
          .diagnosis-section h3 {
            color: #2c5aa0;
            margin-bottom: 10px;
            font-size: 16px;
          }
          
          .prescription-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 25px;
          }
          
          .prescription-table th {
            background-color: #2c5aa0;
            color: white;
            padding: 12px;
            text-align: left;
            font-size: 14px;
          }
          
          .prescription-table td {
            padding: 10px 12px;
            border-bottom: 1px solid #ddd;
            font-size: 13px;
          }
          
          .prescription-table tr:nth-child(even) {
            background-color: #f8f9fa;
          }
          
          .prescription-table tr:hover {
            background-color: #e9ecef;
          }
          
          .note-section {
            background-color: #fff3cd;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #ffc107;
            margin-bottom: 25px;
          }
          
          .note-section h3 {
            color: #856404;
            margin-bottom: 10px;
            font-size: 16px;
          }
          
          .footer {
            margin-top: 40px;
            text-align: right;
          }
          
          .signature-box {
            display: inline-block;
            text-align: center;
            min-width: 200px;
          }
          
          .signature-box p {
            margin-bottom: 5px;
            font-style: italic;
            color: #666;
          }
          
          .signature-box .date {
            font-weight: bold;
            margin-bottom: 60px;
          }
          
          .signature-box .doctor-name {
            font-weight: bold;
            color: #2c5aa0;
            border-top: 1px solid #333;
            padding-top: 5px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>ĐƠN THUỐC</h1>
        </div>
        
        <div class="info-section">
          <div class="info-row">
            <span class="info-label">Họ và tên bệnh nhân:</span>
            <span class="info-value">${data.patientName || 'N/A'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Tuổi:</span>
            <span class="info-value">${data.patientAge || 'N/A'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Ngày khám:</span>
            <span class="info-value">${formattedDate}</span>
          </div>
        </div>
        
        <div class="diagnosis-section">
          <h3>Chẩn đoán</h3>
          <p>${data.diagnosis}</p>
        </div>
        
        <h3 style="color: #2c5aa0; margin-bottom: 15px;">Đơn thuốc</h3>
        <table class="prescription-table">
          <thead>
            <tr>
              <th style="width: 5%;">STT</th>
              <th style="width: 35%;">Tên thuốc</th>
              <th style="width: 15%;">Số lượng</th>
              <th style="width: 45%;">Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            ${data.prescriptions
              .map(
                (item, index) => `
              <tr>
                <td>${index + 1}</td>
                <td><strong>${item.name}</strong></td>
                <td>${item.quantity}</td>
                <td>${item.note || ''}</td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
        
        ${
          data.note
            ? `
        <div class="note-section">
          <h3>Lưu ý</h3>
          <p>${data.note}</p>
        </div>
        `
            : ''
        }
        
        <div class="footer">
          <div class="signature-box">
            <p class="date">Ngày ${formattedDate}</p>
            <p>Bác sĩ điều trị</p>
            <p style="margin-top: 50px;">(Ký và ghi rõ họ tên)</p>
            <p class="doctor-name">${data.doctorName || ''}</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}