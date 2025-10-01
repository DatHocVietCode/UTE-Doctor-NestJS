import { Body, Controller, HttpException, HttpStatus, Post } from "@nestjs/common";
import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode as rc } from "src/common/enum/reponse-code.enum";
import { LoginUserReqDto, RegisterUserReqDto } from "./dto/auth-user.dto";
import { AuthService } from "./xac-thuc.service";

@Controller("auth")
export class AuthController
{
    constructor(private readonly authService: AuthService) {}
    @Post("/register")
    async createNewUser(@Body() registerUserDTO: RegisterUserReqDto)
    {
        console.log('Got register request:', registerUserDTO);
        return this.authService.register(registerUserDTO);
    }
    @Post("/login")
    async loginUser(@Body() loginUserDTO: LoginUserReqDto)
    {
        try {
            const result = await this.authService.login(loginUserDTO);
            console.log(result);
            // Nếu đăng nhập thành công → trả 200
            if (result.code === rc.SUCCESS) {
                return result; // { code: rc.SUCCESS, message: "Login successfully!", data: { accessToken, refreshToken } }
            }
            // Nếu sai email hoặc mật khẩu → trả 401 (Unauthorized)
            throw new HttpException(result.message, HttpStatus.UNAUTHORIZED);
        }
        catch (err: any) {
            // Server error
     
            console.error('Error during login:', err);
            throw new HttpException(
                { code: rc.SERVER_ERROR, message: err.message, data: null },
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }
    @Post("/send-otp")
    async sendOTP(@Body() body: { email: string }) {
        const { email } = body;
        return this.authService.handleOTPSending(email);
    }

    @Post('/verify-otp')
    async verifyOtp(
    @Body() body: { email: string; otp: string },
    ): Promise<DataResponse<null>> {
    const { email, otp } = body;

    try {
        const result = await this.authService.verifyOTP(email, otp);

        // Nếu OTP đúng → trả 200
        if (result.code === rc.SUCCESS) {
            return result; // { code: rc.SUCCESS, message: "OTP verify successfully!", data: null }
        }

        // Nếu OTP sai hoặc hết hạn → trả 400 (Bad Request)
        throw new HttpException(result.message, HttpStatus.BAD_REQUEST);
    } catch (err: any) {
        // Server error
        throw new HttpException(
        { code: rc.SERVER_ERROR, message: err.message, data: null },
        HttpStatus.INTERNAL_SERVER_ERROR,
        );
    }
    }
}