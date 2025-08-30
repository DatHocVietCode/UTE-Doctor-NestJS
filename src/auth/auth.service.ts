import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code-enum';
import { UserService } from 'src/users/user.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { LoginUserReqDto, LoginUserResDto, RegisterUserDto } from './dto/auth-user.dto';
@Injectable()
export class AuthService {
    constructor(@InjectModel(User.name) private userModel: Model<UserDocument>
                , private jwtService: JwtService
                ,@Inject(forwardRef(() => UserService)) private userService: UserService) {}

    async register(registerUserDto: RegisterUserDto): Promise<string> {
        const hashedPassword = await bcrypt.hash(registerUserDto.password, 10);
        const createdUser = new this.userModel({
            email: registerUserDto.email,
            password: hashedPassword,
        });
        try
        {
            await createdUser.save();
            return "User registered successfully";
        }
        catch (error)
        {
            return "Error registering user: " + error.message;
        }
    }

    async login(loginUserDto: LoginUserReqDto): Promise<DataResponse<LoginUserResDto>> {
        const user = await this.userModel.findOne({ email: loginUserDto.email }).exec();
        var dataRes: DataResponse<LoginUserResDto> = {
            code: rc.SERVER_ERROR,
            message: "",
            data: { accessToken: "", refreshToken: "" }
        };
        if (!user) {
            dataRes.message = "User not found";
            dataRes.code = rc.USER_NOT_FOUND;
            return dataRes;
        }
        
        const isPasswordValid = await bcrypt.compare(loginUserDto.password, user.password);
        if (!isPasswordValid) {
            dataRes.message = "Invalid password";
            dataRes.code = rc.ERROR;
            return dataRes;
        }
        dataRes.message = "Login Successful";
        const refreshTokenRespone = await this.userService.getUserRefreshToken(user.email); 
        console.log(refreshTokenRespone.data)
        const accessToken = await this.createAccessToken(loginUserDto.email);
        if (dataRes.data)
        {
            dataRes.data.accessToken = accessToken;
            if (refreshTokenRespone)
            {
                if (refreshTokenRespone.data)
                    dataRes.data.refreshToken = refreshTokenRespone.data;
            }
        }
        return dataRes;
    }

    createAccessToken(email: string): string {
        // Implement JWT token creation logic here
        const payload = { sub: email };
        console.log("Creating access token with payload:", payload);
        const token = this.jwtService.sign(payload, 
            {
                secret: process.env.JWT_SECRET,
                expiresIn: process.env.JWT_EXPIRES_IN
            }
        );
        return token;
    }

    createRefreshToken(email: string): string {
        // Implement JWT refresh token creation logic here
        const payload = { sub: email };
        console.log("Creating refresh token with payload:", payload);
        const refreshToken = this.jwtService.sign(payload, 
            {
                secret: process.env.JWT_REFRESH_SECRET,
                expiresIn: process.env.JWT_REFRESH_EXPIRES_IN
            }
        );
        return refreshToken;
    }
}