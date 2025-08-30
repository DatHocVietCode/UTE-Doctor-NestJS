import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import * as jwt from "jsonwebtoken";
import { Model } from 'mongoose';
import { AuthService } from 'src/auth/auth.service';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code-enum';
import { CreateUserDto } from './dto/create-user.dto';
import { User, UserDocument } from './schemas/user.schema';
@Injectable()
export class UserService {
    constructor(@InjectModel(User.name) private userModel: Model<UserDocument>
                , private readonly authService: AuthService) {}

    async create(createUserDto: CreateUserDto): Promise<string> {
        const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
        const createdUser = new this.userModel({
            email: createUserDto.email,
            password: hashedPassword,
        });
        try
        {
            await createdUser.save();
            return "User created successfully";
        }
        catch (error)
        {
            return "Error creating user: " + error.message;
        }
    }

    async findAll(): Promise<User[]> {
        return this.userModel.find().exec();
    }

    async findOne(id: string): Promise<User | null> {
        return this.userModel.findById(id).exec();
    }

    async findByEmail(email: string): Promise<User | null> {
        return this.userModel.findOne({ email }).exec();
    }

    async update(id: string, updateUserDto: Partial<User>): Promise<User | null> {
        if (updateUserDto.password) {
            updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
        }
        return this.userModel
            .findByIdAndUpdate(id, updateUserDto, { new: true })
            .exec();
    }

    async remove(id: string): Promise<User | null> {
        return this.userModel.findByIdAndDelete(id).exec();
    }

    async getUserRefreshToken(email: string) : Promise<DataResponse<string>>
    {
        const user = await this.findByEmail(email);
        const dataRes: DataResponse= {
            message: "",
            code: rc.SERVER_ERROR,
            data: ""
        }
        if (!user)
        {
            dataRes.code = rc.USER_NOT_FOUND;
            dataRes.message = "User not found";
        }
        else
        {
            if (user.refreshToken)
            {
                if (this.isTokenAlive(user.refreshToken))
                {
                    dataRes.code = rc.SUCCESS;
                    dataRes.message = "Successfully get refresh token";
                    dataRes.data = user.refreshToken;
                }
            }
            else
            {
                const newRefreshToken = this.authService.createRefreshToken(email);
                dataRes.code = rc.SUCCESS;
                dataRes.message = "Successfully create new refresh token";
                dataRes.data = newRefreshToken;
            }
        }
        return dataRes;
    }
    
    isTokenAlive(token: string) : boolean
    {
        try
        {
            const decode = jwt.decode(token) as { exp?: number } | null;
            if (!decode || !decode.exp)
            {
                return false;
            }
            else
            {
                const currentTime = Math.floor(Date.now() / 1000);
                return decode.exp > currentTime;
            }
        }
        catch (error)
        {
            console.log("Error while checking token life time: " + error);
            return false;
        }
    }
}