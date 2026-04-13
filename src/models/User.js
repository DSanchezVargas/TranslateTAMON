const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  nombre: { 
    type: String, 
    required: true,
    trim: true
  },
  correo: { 
    type: String, 
    required: true, 
    unique: true, // Esto evita que dos personas se registren con el mismo email
    lowercase: true,
    trim: true
  },
  password: { 
    type: String, 
    required: true 
  },
  plan: {
    type: String,
    enum: ['free', 'pro_plus'],
    default: 'free'
  },
  fechaRegistro: { 
    type: Date, 
    default: Date.now 
  }
});

// Este es un "middleware" de Mongoose. 
// Justo antes de guardar el usuario en MongoDB, encripta la contraseña.
userSchema.pre('save', async function(next) {
  const user = this;
  
  // Si la contraseña no ha sido modificada, avanzamos
  if (!user.isModified('password')) return next();

  try {
    // Generamos un "salt" (texto aleatorio) y hasheamos la contraseña
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(user.password, salt);
    next();
  } catch (error) {
    return next(error);
  }
});

// Método para comparar la contraseña cuando el usuario intente hacer login
userSchema.methods.compararPassword = async function(passwordCandidata) {
  return await bcrypt.compare(passwordCandidata, this.password);
};

module.exports = mongoose.model('User', userSchema);