import { Controller, Post, Body, Param } from '@nestjs/common';
import { CreatePrescriptionPdfDto } from 'src/prescription/dto/create.pdf';
import { PrescriptionPdfService } from 'src/prescription/prescription-pdf.service';

@Controller('prescription')
export class PrescriptionController {
  constructor(private readonly pdfService: PrescriptionPdfService) {}

  @Post(':id/generate-pdf')
  async generatePdf(
    @Param('id') id: string,
    @Body() data: CreatePrescriptionPdfDto,
  ) {
    const urlPath = await this.pdfService.generatePrescriptionPdf(id, data);

    const port = process.env.PORT ?? 3000;
    const host = process.env.BASE_URL ?? `http://localhost:${port}`;
    const fullUrl = `${host}${urlPath}`;

    return {
      code: 'SUCCESS',
      message: 'PDF generated successfully',
      data: {
        url: fullUrl,
      },
    };
  }
}