import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type NewsDocument = HydratedDocument<News>;

@Schema({ timestamps: true })
export class News {

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true })
  imageUrl: string;          

  @Prop({ required: true })
  content: string;           

  @Prop({ required: true })
  startDate: Date;           

  @Prop({ required: true })
  endDate: Date;         

  @Prop({ default: true })
  isActive: boolean;      
}

export const NewsSchema = SchemaFactory.createForClass(News);
